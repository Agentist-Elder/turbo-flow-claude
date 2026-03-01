/**
 * Phase 9 — Layer-3 API Gateway
 *
 * Single-endpoint HTTP server that acts as the front door for System 1.
 *
 * Endpoint:  POST /api/v1/verify-coherence
 * Request:   Content-Type: application/octet-stream  (raw bytes; no JSON)
 * Response:  Content-Type: application/octet-stream  (4-byte LE u32 RC code)
 *
 * Request flow:
 *   1. Reject non-octet-stream payloads with 415.
 *   2. Compute a 16-byte SHA-256 content digest from the incoming body.
 *   3. Use Phase 8 KeyManager / ProvenanceBuilder to sign the 24-byte envelope
 *      (content_digest ++ timestamp_ns_LE) with the gateway's ED25519 keypair.
 *   4. Pass the fully signed SecurityRequest FlatBuffer to the Phase 7 WasmGateBridge.
 *   5. Return the 4-byte LE RC code (RC_ALLOW=0, RC_DENY=1, …) as the response body.
 *
 * JSON is strictly forbidden at this boundary (CLAUDE.md §5 FlatBuffers Mandate).
 */

import {
  createServer,
  IncomingMessage,
  ServerResponse,
  Server,
  AddressInfo,
} from 'node:http';
import { createHash } from 'node:crypto';

import {
  WasmGateBridge,
  RC_ALLOW, RC_DENY, RC_CHALLENGE, RC_QUARANTINE,
} from './wasm-bridge.js';
import { generateKeypair, Ed25519Keypair } from './key-manager.js';
import { buildSignedSecurityRequest } from './provenance-builder.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VERIFY_PATH = '/api/v1/verify-coherence';
const MAX_BODY_BYTES = 64 * 1024; // matches WASM gate MAX_MESSAGE_BYTES

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GatewayOptions {
  /** Pre-initialized WASM bridge (Phase 7). */
  bridge: WasmGateBridge;
  /**
   * ED25519 keypair used to sign provenance records.
   * Defaults to a freshly generated keypair if omitted.
   */
  keypair?: Ed25519Keypair;
}

/**
 * L3Gateway — HTTP server that mediates between external callers and System 1.
 *
 * Create with `L3Gateway.create(opts)`, start listening with `listen(port)`,
 * and shut down cleanly with `close()`.
 */
export class L3Gateway {
  private readonly server: Server;
  private readonly bridge: WasmGateBridge;
  private readonly keypair: Ed25519Keypair;
  private requestSeq = 0n;

  private constructor(bridge: WasmGateBridge, keypair: Ed25519Keypair) {
    this.bridge = bridge;
    this.keypair = keypair;
    this.server = createServer(this.handleRequest.bind(this));
  }

  /** Construct a gateway around an already-initialized WasmGateBridge. */
  static create(opts: GatewayOptions): L3Gateway {
    return new L3Gateway(opts.bridge, opts.keypair ?? generateKeypair());
  }

  /**
   * Start listening on the given port (0 = OS-assigned ephemeral port).
   * Resolves once the server is bound and ready to accept connections.
   */
  listen(port: number, host = '127.0.0.1'): Promise<void> {
    return new Promise((resolve) => this.server.listen(port, host, resolve));
  }

  /** Gracefully shut down the HTTP server. */
  close(): Promise<void> {
    return new Promise((resolve, reject) =>
      this.server.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /** Returns the bound address (port, host) after `listen()`. */
  get address(): AddressInfo | string | null {
    return this.server.address();
  }

  // -------------------------------------------------------------------------
  // Private request handler
  // -------------------------------------------------------------------------

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only POST to the verify endpoint is supported.
    if (req.method !== 'POST' || req.url !== VERIFY_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not Found');
      return;
    }

    // Enforce strict content-type: application/octet-stream only.
    // Strip any parameters (e.g. "; charset=...") before comparing.
    const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/octet-stream') {
      res.writeHead(415, { 'Content-Type': 'text/plain' })
        .end('Unsupported Media Type: Content-Type must be application/octet-stream');
      return;
    }

    // Collect body with a hard size cap.
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'text/plain' }).end('Payload Too Large');
        }
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (res.headersSent) return; // 413 already sent
      try {
        const rc = this.processBody(Buffer.concat(chunks));
        const rcBuf = Buffer.allocUnsafe(4);
        rcBuf.writeUInt32LE(rc, 0);
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(rcBuf);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal Server Error');
      }
    });

    req.on('error', () => {
      if (!res.headersSent) res.writeHead(500).end();
    });
  }

  // -------------------------------------------------------------------------
  // Core processing — sign and validate
  // -------------------------------------------------------------------------

  /**
   * Given the raw body bytes from the HTTP request:
   *   1. Compute a 16-byte content digest (SHA-256, first 16 bytes).
   *   2. Build a signed SecurityRequest FlatBuffer via Phase 8 provenance builder.
   *   3. Pass to the Phase 7 WASM bridge.
   *   4. Return the raw u32 RC code.
   */
  private processBody(body: Buffer): number {
    // SHA-256 truncated to 16 bytes — stand-in for XXH3-128 (same 128-bit width).
    const hashBuf = createHash('sha256').update(body).digest();
    const contentDigest = new Uint8Array(hashBuf.buffer, hashBuf.byteOffset, 16);

    const fbs = buildSignedSecurityRequest({
      requestId:     ++this.requestSeq,
      contentDigest,
      privateKey:    this.keypair.privateKey,
      publicKeyBytes: this.keypair.publicKeyBytes,
    });

    const decision = this.bridge.processSecurityRequest(fbs);

    switch (decision.kind) {
      case 'allow':     return RC_ALLOW;
      case 'deny':      return RC_DENY;
      case 'challenge': return RC_CHALLENGE;
      case 'quarantine': return RC_QUARANTINE;
      default:          return decision.code;
    }
  }
}
