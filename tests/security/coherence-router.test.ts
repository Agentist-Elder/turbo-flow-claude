/**
 * Phase 11 — CoherenceRouter integration tests
 *
 * Spins up a mock HTTP server simulating the Phase 9 L3 Gateway.
 * Validates all routing paths, quarantine modes, neuralyzer semantics,
 * and fail-closed behaviour for both error classes.
 *
 * Test matrix:
 *   RC_ALLOW                              → outcome='clean',      no neuralyzer
 *   RC_DENY / RC_CHALLENGE / RC_QUARANTINE → outcome='quarantined', neuralyzer fires
 *   CoherenceProtocolError (413, 415)     → outcome='dropped',    no neuralyzer
 *   CoherenceConnectionError (500, unreachable) → outcome='dropped', no neuralyzer
 *   mode='reject'  / mode='sanitize'      → record.mode matches config
 *   String payload                        → stored as UTF-8 Buffer in record
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import {
  CoherenceRouter,
  QuarantineRecord,
  RouterResult,
} from '../../packages/host-rpc-server/src/coherence-router.js';
import {
  CoherenceProtocolError,
  CoherenceConnectionError,
} from '../../packages/host-rpc-server/src/coherence-client.js';

// ---------------------------------------------------------------------------
// Mock gateway
// ---------------------------------------------------------------------------

let mockStatus = 200;
let mockBody   = Buffer.alloc(4, 0); // default: RC_ALLOW

function rc(code: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(code, 0);
  return b;
}

function makeMockGateway(): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(mockStatus, { 'Content-Type': 'application/octet-stream' });
      res.end(mockBody);
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all neuralyzer calls into an array for inspection. */
function makeCallSpy() {
  const calls: Array<{ daughterId: string; record: QuarantineRecord }> = [];
  return {
    calls,
    fn: (daughterId: string, record: QuarantineRecord) => {
      calls.push({ daughterId, record });
    },
  };
}

/** Collect all onDropped calls. */
function makeDropSpy() {
  const calls: Array<{ daughterId: string; reason: string; error: unknown }> = [];
  return {
    calls,
    fn: (daughterId: string, reason: string, error: unknown) => {
      calls.push({ daughterId, reason, error });
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('CoherenceRouter', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = makeMockGateway();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  beforeEach(() => {
    mockStatus = 200;
    mockBody   = rc(0); // RC_ALLOW
  });

  // -------------------------------------------------------------------------
  // RC_ALLOW — clean stream, no neuralyzer
  // -------------------------------------------------------------------------

  it('RC_ALLOW → outcome clean, decision allow, no neuralyzer', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(0); // RC_ALLOW
    const result = await router.route('safe payload', 'daughter-1');

    expect(result.outcome).toBe('clean');
    expect(result.decision).toBe('allow');
    expect(result.daughterId).toBe('daughter-1');
    expect(result.quarantineRecord).toBeUndefined();
    expect(spy.calls).toHaveLength(0);
  });

  it('RC_ALLOW — neuralyzer is never called regardless of quarantine mode', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'sanitize',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(0);
    await router.route(Buffer.from([0x01, 0x02]), 'daughter-safe');

    expect(spy.calls).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // RC_DENY — quarantined, neuralyzer fires
  // -------------------------------------------------------------------------

  it('RC_DENY → outcome quarantined, decision deny, neuralyzer fires', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1); // RC_DENY
    const result = await router.route('malicious content', 'daughter-bad');

    expect(result.outcome).toBe('quarantined');
    expect(result.decision).toBe('deny');
    expect(result.daughterId).toBe('daughter-bad');
    expect(result.quarantineRecord).toBeDefined();
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.daughterId).toBe('daughter-bad');
    expect(spy.calls[0]!.record.decision).toBe('deny');
  });

  // -------------------------------------------------------------------------
  // RC_CHALLENGE — treated as compromised (no challenge-response mechanism yet)
  // -------------------------------------------------------------------------

  it('RC_CHALLENGE → outcome quarantined, decision challenge, neuralyzer fires', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(2); // RC_CHALLENGE
    const result = await router.route('ambiguous content', 'daughter-c');

    expect(result.outcome).toBe('quarantined');
    expect(result.decision).toBe('challenge');
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.record.decision).toBe('challenge');
  });

  // -------------------------------------------------------------------------
  // RC_QUARANTINE — treated as compromised
  // -------------------------------------------------------------------------

  it('RC_QUARANTINE → outcome quarantined, decision quarantine, neuralyzer fires', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(3); // RC_QUARANTINE
    const result = await router.route('isolated content', 'daughter-q');

    expect(result.outcome).toBe('quarantined');
    expect(result.decision).toBe('quarantine');
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.record.decision).toBe('quarantine');
  });

  // -------------------------------------------------------------------------
  // QuarantineMode — reject vs. sanitize
  // -------------------------------------------------------------------------

  it('quarantineMode=reject is recorded in the QuarantineRecord', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1);
    const result = await router.route('payload', 'daughter-r');

    expect(result.quarantineRecord!.mode).toBe('reject');
    expect(spy.calls[0]!.record.mode).toBe('reject');
  });

  it('quarantineMode=sanitize is recorded in the QuarantineRecord', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'sanitize',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1);
    const result = await router.route('payload', 'daughter-s');

    expect(result.quarantineRecord!.mode).toBe('sanitize');
    expect(spy.calls[0]!.record.mode).toBe('sanitize');
  });

  // -------------------------------------------------------------------------
  // QuarantineRecord content
  // -------------------------------------------------------------------------

  it('QuarantineRecord carries the raw payload bytes', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1);
    const originalPayload = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    const result = await router.route(originalPayload, 'daughter-payload');

    expect(result.quarantineRecord!.payload).toEqual(originalPayload);
  });

  it('string payload is UTF-8 encoded and stored in QuarantineRecord', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'sanitize',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1);
    const text = 'こんにちは'; // multi-byte UTF-8
    const result = await router.route(text, 'daughter-utf8');

    expect(result.quarantineRecord!.payload).toEqual(Buffer.from(text, 'utf-8'));
  });

  it('QuarantineRecord.timestampNs is a non-zero bigint', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1);
    const result = await router.route('payload', 'daughter-ts');

    expect(typeof result.quarantineRecord!.timestampNs).toBe('bigint');
    expect(result.quarantineRecord!.timestampNs).toBeGreaterThan(0n);
  });

  it('QuarantineRecord.daughterId matches the route() argument', async () => {
    const spy    = makeCallSpy();
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: spy.fn,
    });

    mockBody = rc(1);
    await router.route('payload', 'agent-xyz-42');

    expect(spy.calls[0]!.record.daughterId).toBe('agent-xyz-42');
  });

  // -------------------------------------------------------------------------
  // Fail-closed: CoherenceProtocolError (4xx) → dropped, no neuralyzer
  // -------------------------------------------------------------------------

  it('413 → outcome dropped, onDropped fired with protocol-error:413, no neuralyzer', async () => {
    const neuralyzer = makeCallSpy();
    const dropSpy    = makeDropSpy();
    const router     = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: neuralyzer.fn,
      onDropped: dropSpy.fn,
    });

    mockStatus = 413;
    mockBody   = Buffer.from('Payload Too Large');
    const result = await router.route('too big', 'daughter-413');

    expect(result.outcome).toBe('dropped');
    expect(result.decision).toBeUndefined();
    expect(result.quarantineRecord).toBeUndefined();
    expect(neuralyzer.calls).toHaveLength(0);
    expect(dropSpy.calls).toHaveLength(1);
    expect(dropSpy.calls[0]!.daughterId).toBe('daughter-413');
    expect(dropSpy.calls[0]!.reason).toBe('protocol-error:413');
    expect(dropSpy.calls[0]!.error).toBeInstanceOf(CoherenceProtocolError);
  });

  it('415 → outcome dropped, onDropped fired with protocol-error:415, no neuralyzer', async () => {
    const neuralyzer = makeCallSpy();
    const dropSpy    = makeDropSpy();
    const router     = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: neuralyzer.fn,
      onDropped: dropSpy.fn,
    });

    mockStatus = 415;
    mockBody   = Buffer.from('Unsupported Media Type');
    const result = await router.route('wrong type', 'daughter-415');

    expect(result.outcome).toBe('dropped');
    expect(neuralyzer.calls).toHaveLength(0);
    expect(dropSpy.calls[0]!.reason).toBe('protocol-error:415');
    expect(dropSpy.calls[0]!.error).toBeInstanceOf(CoherenceProtocolError);
  });

  // -------------------------------------------------------------------------
  // Fail-closed: CoherenceConnectionError (5xx / unreachable) → dropped
  // -------------------------------------------------------------------------

  it('500 → outcome dropped, onDropped fired with connection-error, no neuralyzer', async () => {
    const neuralyzer = makeCallSpy();
    const dropSpy    = makeDropSpy();
    const router     = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: neuralyzer.fn,
      onDropped: dropSpy.fn,
    });

    mockStatus = 500;
    mockBody   = Buffer.from('Internal Server Error');
    const result = await router.route('test', 'daughter-500');

    expect(result.outcome).toBe('dropped');
    expect(neuralyzer.calls).toHaveLength(0);
    expect(dropSpy.calls[0]!.reason).toBe('connection-error');
    expect(dropSpy.calls[0]!.error).toBeInstanceOf(CoherenceConnectionError);
  });

  it('unreachable gateway → outcome dropped, connection-error, no neuralyzer', async () => {
    const neuralyzer = makeCallSpy();
    const dropSpy    = makeDropSpy();
    const router     = new CoherenceRouter({
      gatewayUrl: 'http://127.0.0.1:1', // nothing listens here
      quarantineMode: 'reject',
      onDaughterCompromised: neuralyzer.fn,
      onDropped: dropSpy.fn,
    });

    const result = await router.route('test', 'daughter-dead');

    expect(result.outcome).toBe('dropped');
    expect(neuralyzer.calls).toHaveLength(0);
    expect(dropSpy.calls[0]!.reason).toBe('connection-error');
    expect(dropSpy.calls[0]!.error).toBeInstanceOf(CoherenceConnectionError);
  });

  // -------------------------------------------------------------------------
  // onDropped is optional — no error when omitted
  // -------------------------------------------------------------------------

  it('omitting onDropped does not throw when gateway errors occur', async () => {
    const router = new CoherenceRouter({
      gatewayUrl: `http://127.0.0.1:${port}`,
      quarantineMode: 'reject',
      onDaughterCompromised: () => {},
      // onDropped intentionally omitted
    });

    mockStatus = 500;
    mockBody   = Buffer.from('boom');

    // Should resolve cleanly, not throw.
    const result = await router.route('test', 'daughter-nospy');
    expect(result.outcome).toBe('dropped');
  });

  // -------------------------------------------------------------------------
  // route() never throws — all errors are caught internally
  // -------------------------------------------------------------------------

  it('route() resolves (never rejects) even when the gateway is unreachable', async () => {
    const router = new CoherenceRouter({
      gatewayUrl: 'http://127.0.0.1:1',
      quarantineMode: 'reject',
      onDaughterCompromised: () => {},
    });

    await expect(router.route('test', 'daughter-resilient')).resolves.toBeDefined();
  });
});
