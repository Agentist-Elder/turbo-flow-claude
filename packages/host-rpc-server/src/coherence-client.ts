/**
 * Phase 10 — Coherence Client SDK (Symbiote)
 *
 * Zero-dependency HTTP client for the Phase 9 L3 Gateway.
 * External agentic apps use this to verify content coherence
 * before submitting to an LLM.
 *
 * Usage:
 *   const client = new CoherenceClient({ gatewayUrl: 'http://127.0.0.1:8080' });
 *   const result = await client.verifyDecision(content);
 *   // result.decision === 'allow' | 'deny' | 'challenge' | 'quarantine'
 *
 * Error semantics (critical for a security gate):
 *   - CoherenceProtocolError  — gateway returned 4xx; the gate NEVER RAN.
 *   - CoherenceConnectionError — network failure or 5xx; the gate NEVER RAN.
 *   Both must be caught and handled explicitly by the caller. They must never
 *   be silently conflated with RC_DENY (which means the gate ran and denied).
 */

import { request as httpRequest, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERIFY_PATH    = '/api/v1/verify-coherence';
const RESPONSE_BYTES = 4; // 4-byte little-endian uint32 RC code

// RC codes — must stay in sync with wasm-security-gate/src/lib.rs
const RC_ALLOW      = 0;
const RC_DENY       = 1;
const RC_CHALLENGE  = 2;
const RC_QUARANTINE = 3;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Successful coherence decision — the gate ran and returned a result. */
export type CoherenceResult =
  | { decision: 'allow' }
  | { decision: 'deny' }
  | { decision: 'challenge' }
  | { decision: 'quarantine' };

/**
 * Thrown when the gateway rejects the request at the HTTP protocol layer.
 * The coherence gate NEVER RAN — this is a client misconfiguration or
 * a payload that violated a gateway constraint (size, content-type, routing).
 *
 * Common statusCode values:
 *   404 — wrong endpoint path or HTTP method
 *   413 — payload exceeds 64 KiB (gateway MAX_BODY_BYTES)
 *   415 — wrong Content-Type (must be application/octet-stream)
 */
export class CoherenceProtocolError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'CoherenceProtocolError';
    this.statusCode = statusCode;
  }
}

/**
 * Thrown when the gateway is unreachable or returns an unexpected 5xx error.
 * The coherence gate NEVER RAN — the caller must apply its own fallback policy.
 * Do NOT assume the content is safe; assume the check did not occur.
 */
export class CoherenceConnectionError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'CoherenceConnectionError';
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// CoherenceClient
// ---------------------------------------------------------------------------

export interface CoherenceClientOptions {
  /**
   * Base URL of the L3 Gateway.
   * Example: 'http://127.0.0.1:8080'
   * The client always POSTs to <gatewayUrl>/api/v1/verify-coherence.
   */
  gatewayUrl: string;
}

/**
 * CoherenceClient — Symbiote SDK for the L3 Gateway.
 *
 * Holds no mutable state; each verifyDecision call creates a fresh
 * HTTP request. Safe to share across concurrent callers.
 */
export class CoherenceClient {
  private readonly url: URL;

  constructor(opts: CoherenceClientOptions) {
    this.url = new URL(VERIFY_PATH, opts.gatewayUrl);
  }

  /**
   * Submit content for a coherence check against System 1 (the WASM gate).
   *
   * @param content  The text or binary payload to check.
   *                 Strings are encoded as UTF-8 before transmission.
   *                 Must not exceed 64 KiB (the gateway's hard limit).
   *
   * @returns A typed CoherenceResult when the gate ran and produced a decision.
   *
   * @throws {CoherenceProtocolError}   Gateway returned 4xx — gate never ran.
   * @throws {CoherenceConnectionError} Network failure or 5xx — gate never ran.
   */
  async verifyDecision(content: string | Buffer): Promise<CoherenceResult> {
    const body = typeof content === 'string'
      ? Buffer.from(content, 'utf-8')
      : content;

    const responseBody = await this.post(body);
    return this.decodeRc(responseBody);
  }

  // -------------------------------------------------------------------------
  // Private — HTTP transport (node:http / node:https, zero external deps)
  // -------------------------------------------------------------------------

  private post(body: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const isHttps = this.url.protocol === 'https:';
      const requester = isHttps ? httpsRequest : httpRequest;

      const opts: RequestOptions = {
        hostname: this.url.hostname,
        port:     Number(this.url.port) || (isHttps ? 443 : 80),
        path:     this.url.pathname + this.url.search,
        method:   'POST',
        headers: {
          'Content-Type':   'application/octet-stream',
          'Content-Length': body.byteLength,
        },
      };

      const req = requester(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const buf    = Buffer.concat(chunks);

          if (status === 200) {
            resolve(buf);
            return;
          }

          // 4xx — protocol-level rejection; the gate never ran.
          if (status >= 400 && status < 500) {
            reject(new CoherenceProtocolError(
              status,
              `Gateway rejected request: HTTP ${status} ${buf.toString('utf-8').trim()}`,
            ));
            return;
          }

          // 5xx or any other non-200 — treat as connection/infrastructure error.
          reject(new CoherenceConnectionError(
            `Gateway returned unexpected status: HTTP ${status}`,
            { statusCode: status, body: buf.toString('utf-8').trim() },
          ));
        });
        res.on('error', (err: unknown) => {
          reject(new CoherenceConnectionError('Response stream error', err));
        });
      });

      req.on('error', (err: unknown) => {
        reject(new CoherenceConnectionError('HTTP request failed', err));
      });

      req.end(body);
    });
  }

  // -------------------------------------------------------------------------
  // Private — RC code decoding
  // -------------------------------------------------------------------------

  private decodeRc(buf: Buffer): CoherenceResult {
    if (buf.byteLength < RESPONSE_BYTES) {
      throw new CoherenceConnectionError(
        `Gateway returned ${buf.byteLength}-byte response; expected ${RESPONSE_BYTES}`,
        { responseByteLength: buf.byteLength },
      );
    }

    const rc = buf.readUInt32LE(0);
    switch (rc) {
      case RC_ALLOW:      return { decision: 'allow' };
      case RC_DENY:       return { decision: 'deny' };
      case RC_CHALLENGE:  return { decision: 'challenge' };
      case RC_QUARANTINE: return { decision: 'quarantine' };
      default:
        throw new CoherenceConnectionError(
          `Gateway returned unknown RC code: 0x${rc.toString(16).padStart(8, '0')}`,
          { rc },
        );
    }
  }
}
