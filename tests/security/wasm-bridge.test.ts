/**
 * Phase 7 — WASM Bridge integration tests
 *
 * These tests verify the Node-to-WASM boundary:
 *   1. The bridge can load and initialise the compiled wasm-security-gate binary.
 *   2. FlatBuffers-encoded requests are correctly written into WASM linear memory.
 *   3. Return codes are accurately decoded into typed RcDecision objects.
 *
 * Expected results without valid ED25519 provenance:
 *   - A well-formed FlatBuffer with no provenance field → RC_DENY (default-deny).
 *   - Garbage bytes that fail the FlatBuffers verifier → RC_ERR_PARSE.
 *   - Empty buffer → RC_ERR_PARSE (size > 0 but structurally invalid).
 *
 * The test does NOT attempt to produce a valid signed request — that would
 * require a live ED25519 keypair and is out of scope for the bridge layer.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import {
  WasmGateBridge,
  buildMinimalSecurityRequest,
  buildSecurityRequestWithCallerId,
  RC_ALLOW,
  RC_DENY,
} from '../../packages/host-rpc-server/src/wasm-bridge.js';

const WASM_PATH = join(
  process.cwd(),
  'target/wasm32-unknown-unknown/release/wasm_security_gate.wasm',
);

describe('WasmGateBridge — Phase 7 bridge integration', () => {
  let bridge: WasmGateBridge;

  beforeAll(async () => {
    bridge = await WasmGateBridge.create(WASM_PATH);
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('gate_init succeeds — bridge constructs without throwing', () => {
    expect(bridge).toBeDefined();
  });

  it('isHealthy returns true after successful initialisation', () => {
    expect(bridge.isHealthy).toBe(true);
  });

  // -------------------------------------------------------------------------
  // processSecurityRequest — correct FlatBuffers, absent provenance → DENY
  // -------------------------------------------------------------------------

  it('minimal request (no provenance) returns deny', () => {
    const now = BigInt(Date.now()) * BigInt(1_000_000); // ms → ns
    const bytes = buildMinimalSecurityRequest(BigInt(1), now);
    const result = bridge.processSecurityRequest(bytes);
    // Gate returns RC_DENY because provenance is absent (default-deny policy).
    expect(result.kind).toBe('deny');
  });

  it('request with caller_did byte vector (no provenance) returns deny', () => {
    const now  = BigInt(Date.now()) * BigInt(1_000_000);
    const did  = new TextEncoder().encode('did:example:abc123');
    const bytes = buildSecurityRequestWithCallerId(BigInt(2), did, now);
    const result = bridge.processSecurityRequest(bytes);
    expect(result.kind).toBe('deny');
  });

  it('each request increments request_id without crashing the gate', () => {
    const now = BigInt(Date.now()) * BigInt(1_000_000);
    for (let i = 3n; i <= 10n; i++) {
      const bytes  = buildMinimalSecurityRequest(i, now + i * 1_000_000n);
      const result = bridge.processSecurityRequest(bytes);
      // All should be deny (no provenance) — gate must remain operational.
      expect(result.kind).toBe('deny');
    }
  });

  // -------------------------------------------------------------------------
  // processSecurityRequest — invalid/malformed buffers → error
  // -------------------------------------------------------------------------

  it('empty buffer returns parse error', () => {
    const result = bridge.processSecurityRequest(new Uint8Array(0));
    expect(result.kind).toBe('error');
  });

  it('single zero byte returns parse error', () => {
    const result = bridge.processSecurityRequest(new Uint8Array(1));
    expect(result.kind).toBe('error');
  });

  it('garbage bytes (0xAA fill) return parse error', () => {
    const garbage = new Uint8Array(64).fill(0xaa);
    const result  = bridge.processSecurityRequest(garbage);
    expect(result.kind).toBe('error');
  });

  it('buffer exceeding 64 KiB returns error without entering WASM', () => {
    const oversized = new Uint8Array(64 * 1024 + 1);
    const result    = bridge.processSecurityRequest(oversized);
    expect(result.kind).toBe('error');
    expect(result.kind === 'error' && result.detail).toMatch(/64 KiB/);
  });

  // -------------------------------------------------------------------------
  // applySignatureUpdate — without valid provenance → deny
  // -------------------------------------------------------------------------

  it('applySignatureUpdate with empty buffer returns error', () => {
    const result = bridge.applySignatureUpdate(new Uint8Array(0));
    expect(result.kind).toBe('error');
  });

  it('applySignatureUpdate with garbage bytes returns parse error', () => {
    const garbage = new Uint8Array(32).fill(0xff);
    const result  = bridge.applySignatureUpdate(garbage);
    expect(result.kind).toBe('error');
  });

  // -------------------------------------------------------------------------
  // Concurrency safety — sequential calls don't corrupt scratch memory
  // -------------------------------------------------------------------------

  it('100 sequential requests all return consistent decisions', () => {
    const base = BigInt(Date.now()) * BigInt(1_000_000);
    for (let i = 0; i < 100; i++) {
      const bytes  = buildMinimalSecurityRequest(BigInt(100 + i), base + BigInt(i) * 1_000_000n);
      const result = bridge.processSecurityRequest(bytes);
      expect(result.kind).toBe('deny');
    }
  });
});
