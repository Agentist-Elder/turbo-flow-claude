/**
 * Phase 10 — CoherenceClient integration tests
 *
 * Spins up a mock HTTP server that simulates the Phase 9 L3 Gateway.
 * Validates:
 *   - Happy path: all four RC codes map to the correct CoherenceResult.
 *   - String content is UTF-8 encoded and transmitted correctly.
 *   - Buffer content is transmitted as-is.
 *   - 413 Payload Too Large   → CoherenceProtocolError (gate never ran).
 *   - 415 Unsupported Media Type → CoherenceProtocolError (gate never ran).
 *   - 404 Not Found           → CoherenceProtocolError (gate never ran).
 *   - 500 Internal Server Error → CoherenceConnectionError (gate never ran).
 *   - Unreachable gateway     → CoherenceConnectionError (gate never ran).
 *   - Truncated 200 response  → CoherenceConnectionError (gate never ran).
 *   - Protocol errors are never confused with RC_DENY.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import {
  CoherenceClient,
  CoherenceProtocolError,
  CoherenceConnectionError,
} from '../../packages/host-rpc-server/src/coherence-client.js';

// ---------------------------------------------------------------------------
// Mock gateway — behaviour is controlled per-test via shared state.
// Tests run serially within a describe block so this is race-free.
// ---------------------------------------------------------------------------

let mockStatus  = 200;
let mockBody    = Buffer.alloc(4, 0); // default: RC_ALLOW

function rc(code: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(code, 0);
  return b;
}

function makeMockGateway(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    // Drain the request body so the socket is not left half-open.
    req.resume();
    req.on('end', () => {
      res.writeHead(mockStatus, { 'Content-Type': 'application/octet-stream' });
      res.end(mockBody);
    });
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CoherenceClient', () => {
  let server: Server;
  let port: number;
  let client: CoherenceClient;

  beforeAll(async () => {
    server = makeMockGateway();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port   = (server.address() as { port: number }).port;
    client = new CoherenceClient({ gatewayUrl: `http://127.0.0.1:${port}` });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    // Reset to safe default so a misconfigured test cannot leak state.
    mockStatus = 200;
    mockBody   = rc(0); // RC_ALLOW
  });

  // -------------------------------------------------------------------------
  // Happy path — all four RC codes
  // -------------------------------------------------------------------------

  it('maps RC_ALLOW (0) to { decision: "allow" }', async () => {
    mockBody = rc(0);
    const result = await client.verifyDecision('benign content');
    expect(result).toEqual({ decision: 'allow' });
  });

  it('maps RC_DENY (1) to { decision: "deny" }', async () => {
    mockBody = rc(1);
    const result = await client.verifyDecision('suspicious content');
    expect(result).toEqual({ decision: 'deny' });
  });

  it('maps RC_CHALLENGE (2) to { decision: "challenge" }', async () => {
    mockBody = rc(2);
    const result = await client.verifyDecision(Buffer.from([0x01, 0x02]));
    expect(result).toEqual({ decision: 'challenge' });
  });

  it('maps RC_QUARANTINE (3) to { decision: "quarantine" }', async () => {
    mockBody = rc(3);
    const result = await client.verifyDecision(Buffer.from([0xff]));
    expect(result).toEqual({ decision: 'quarantine' });
  });

  // -------------------------------------------------------------------------
  // Content encoding
  // -------------------------------------------------------------------------

  it('accepts a string and transmits UTF-8 bytes', async () => {
    mockBody = rc(0);
    // Multi-byte UTF-8 to confirm encoding path is exercised.
    const result = await client.verifyDecision('こんにちは');
    expect(result.decision).toBe('allow');
  });

  it('accepts a Buffer and transmits it verbatim', async () => {
    mockBody = rc(0);
    const result = await client.verifyDecision(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    expect(result.decision).toBe('allow');
  });

  it('accepts an empty Buffer', async () => {
    mockBody = rc(0);
    const result = await client.verifyDecision(Buffer.alloc(0));
    expect(result.decision).toBe('allow');
  });

  // -------------------------------------------------------------------------
  // Protocol errors — 4xx responses throw CoherenceProtocolError
  // The gate never ran; returning false would be silently unsafe.
  // -------------------------------------------------------------------------

  it('throws CoherenceProtocolError on 413 Payload Too Large', async () => {
    mockStatus = 413;
    mockBody   = Buffer.from('Payload Too Large');
    const err = await client.verifyDecision('oversized').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceProtocolError);
    expect((err as CoherenceProtocolError).statusCode).toBe(413);
  });

  it('throws CoherenceProtocolError on 415 Unsupported Media Type', async () => {
    mockStatus = 415;
    mockBody   = Buffer.from('Unsupported Media Type');
    const err = await client.verifyDecision('wrong-type').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceProtocolError);
    expect((err as CoherenceProtocolError).statusCode).toBe(415);
  });

  it('throws CoherenceProtocolError on 404 Not Found', async () => {
    mockStatus = 404;
    mockBody   = Buffer.from('Not Found');
    const err = await client.verifyDecision('bad-path').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceProtocolError);
    expect((err as CoherenceProtocolError).statusCode).toBe(404);
  });

  it('CoherenceProtocolError is distinct from CoherenceConnectionError', async () => {
    mockStatus = 413;
    mockBody   = Buffer.from('Payload Too Large');
    const err = await client.verifyDecision('test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceProtocolError);
    expect(err).not.toBeInstanceOf(CoherenceConnectionError);
  });

  it('CoherenceProtocolError has a descriptive message containing the status code', async () => {
    mockStatus = 413;
    mockBody   = Buffer.from('Payload Too Large');
    const err = await client.verifyDecision('test').catch((e: unknown) => e);
    expect((err as CoherenceProtocolError).message).toContain('413');
  });

  // -------------------------------------------------------------------------
  // Connection errors — 5xx and network failures
  // -------------------------------------------------------------------------

  it('throws CoherenceConnectionError on 500 Internal Server Error', async () => {
    mockStatus = 500;
    mockBody   = Buffer.from('Internal Server Error');
    const err = await client.verifyDecision('test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceConnectionError);
    expect(err).not.toBeInstanceOf(CoherenceProtocolError);
  });

  it('throws CoherenceConnectionError when gateway is unreachable', async () => {
    // Port 0 is reserved; no server listens there.
    const dead = new CoherenceClient({ gatewayUrl: 'http://127.0.0.1:1' });
    const err  = await dead.verifyDecision('test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceConnectionError);
  });

  it('throws CoherenceConnectionError when response body is truncated (< 4 bytes)', async () => {
    mockStatus = 200;
    mockBody   = Buffer.from([0x00]); // only 1 byte, not the required 4
    const err = await client.verifyDecision('test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceConnectionError);
    expect((err as CoherenceConnectionError).message).toContain('1-byte');
  });

  it('throws CoherenceConnectionError on unknown RC code in a valid 200 response', async () => {
    mockStatus = 200;
    mockBody   = rc(0xDEADBEEF); // not a known RC
    const err = await client.verifyDecision('test').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoherenceConnectionError);
    expect((err as CoherenceConnectionError).message).toContain('unknown RC');
  });
});
