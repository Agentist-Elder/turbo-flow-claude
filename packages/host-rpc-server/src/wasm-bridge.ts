/**
 * Phase 7 — Node-to-WASM Bridge
 *
 * Loads the compiled wasm-security-gate binary and exposes a typed API for
 * passing FlatBuffers-encoded SecurityRequest / SignatureUpdate messages
 * across the WASM/Unix boundary (ADR-026: octet-stream only, no JSON).
 *
 * Memory strategy — "grow-once scratch page":
 *   After gate_init() completes all internal allocations, we grow WASM memory
 *   by one page (64 KB = MAX_MESSAGE_BYTES).  memory.grow() is atomic and
 *   returns the previous page count, so our scratch region is exclusively ours.
 *   We reuse the same 64 KB on every synchronous call; re-acquiring the
 *   Uint8Array view before each write handles any internal grows that may have
 *   detached the previous ArrayBuffer reference.
 *
 * Required host import:
 *   The Rust gate declares `extern "C" { fn host_monotonic_ns() -> u64; }`.
 *   We satisfy it with process.hrtime.bigint() which returns nanoseconds since
 *   an arbitrary stable epoch, matching the gate's monotonic-clock contract.
 */

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Builder } from 'flatbuffers';

// ---------------------------------------------------------------------------
// Return code constants (must stay in sync with wasm-security-gate/src/lib.rs)
// ---------------------------------------------------------------------------

export const RC_ALLOW     = 0;
export const RC_DENY      = 1;
export const RC_CHALLENGE = 2;
export const RC_QUARANTINE = 3;

const RC_ERR_SIZE  = 0xFFFF_FF01;
const RC_ERR_PARSE = 0xFFFF_FF02;
const RC_ERR_OOM   = 0xFFFF_FF03;
const RC_ERR_STATE = 0xFFFF_FF04;

// ---------------------------------------------------------------------------
// Public type for caller-facing results
// ---------------------------------------------------------------------------

export type RcDecision =
  | { kind: 'allow' }
  | { kind: 'deny' }
  | { kind: 'challenge' }
  | { kind: 'quarantine' }
  | { kind: 'error'; code: number; detail: string };

function decodeRc(rc: number): RcDecision {
  switch (rc) {
    case RC_ALLOW:      return { kind: 'allow' };
    case RC_DENY:       return { kind: 'deny' };
    case RC_CHALLENGE:  return { kind: 'challenge' };
    case RC_QUARANTINE: return { kind: 'quarantine' };
    case RC_ERR_SIZE:   return { kind: 'error', code: rc, detail: 'message too large (> 64 KiB)' };
    case RC_ERR_PARSE:  return { kind: 'error', code: rc, detail: 'flatbuffers parse failure' };
    case RC_ERR_OOM:    return { kind: 'error', code: rc, detail: 'embedding vector exceeds limit' };
    case RC_ERR_STATE:  return { kind: 'error', code: rc, detail: 'gate not initialized' };
    default:            return { kind: 'error', code: rc, detail: `unknown rc ${rc}` };
  }
}

// ---------------------------------------------------------------------------
// FlatBuffers schema constants — SecurityRequest (wasm_gate.fbs)
//
// Vtable slot indices (0-based) match the Rust-generated VT_* offsets:
//   VT_REQUEST_ID = 4  → slot 0
//   VT_CALLER_DID = 6  → slot 1
//   VT_PAYLOAD_DIGEST = 8  → slot 2 (inline struct Xxh3Digest, 16 bytes)
//   VT_PROVENANCE = 10 → slot 3 (table)
//   VT_DOMAIN_CONTEXT = 12 → slot 4 (table)
//   VT_FINGERPRINT = 14 → slot 5 (inline struct ProbabilisticFingerprint, 32 bytes)
//   VT_TIMESTAMP_NS = 16 → slot 6
// ---------------------------------------------------------------------------

const NUM_FIELDS_SECURITY_REQUEST = 7;
const SLOT_REQUEST_ID    = 0;
const SLOT_CALLER_DID    = 1;
const SLOT_TIMESTAMP_NS  = 6;

// ---------------------------------------------------------------------------
// SecurityRequestBuilder — FlatBuffers helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal SecurityRequest FlatBuffer with only request_id and
 * timestamp_ns set.  All other fields default to absent.
 *
 * The gate will return RC_DENY (provenance absent → default-deny), which is
 * the expected outcome for an unauthenticated probe used in bridge tests.
 */
export function buildMinimalSecurityRequest(
  requestId: bigint,
  timestampNs: bigint,
): Uint8Array {
  const b = new Builder(256);
  b.startObject(NUM_FIELDS_SECURITY_REQUEST);
  b.addFieldInt64(SLOT_REQUEST_ID,   requestId,   BigInt(0));
  b.addFieldInt64(SLOT_TIMESTAMP_NS, timestampNs, BigInt(0));
  const root = b.endObject();
  b.finish(root);
  return b.asUint8Array();
}

/**
 * Build a SecurityRequest FlatBuffer with request_id, caller_did, and
 * timestamp_ns.  Provenance is still absent so the gate will deny, but the
 * caller_did byte vector exercises the FlatBuffers offset path.
 */
export function buildSecurityRequestWithCallerId(
  requestId: bigint,
  callerDidBytes: Uint8Array,
  timestampNs: bigint,
): Uint8Array {
  const b = new Builder(512);
  const didOffset = b.createByteVector(callerDidBytes);
  b.startObject(NUM_FIELDS_SECURITY_REQUEST);
  b.addFieldInt64(SLOT_REQUEST_ID,   requestId,   BigInt(0));
  b.addFieldOffset(SLOT_CALLER_DID,  didOffset,   0);
  b.addFieldInt64(SLOT_TIMESTAMP_NS, timestampNs, BigInt(0));
  const root = b.endObject();
  b.finish(root);
  return b.asUint8Array();
}

// ---------------------------------------------------------------------------
// WasmGateBridge
// ---------------------------------------------------------------------------

/** Typed interface to the three exported C-ABI functions of the WASM gate. */
interface GateExports extends WebAssembly.Exports {
  memory:                   WebAssembly.Memory;
  gate_init:                () => number;
  process_security_request: (ptr: number, len: number) => number;
  apply_signature_update:   (ptr: number, len: number) => number;
}

const MAX_SCRATCH_BYTES = 64 * 1024; // == MAX_MESSAGE_BYTES in config.rs

/** Default path to the compiled wasm-security-gate binary. */
const DEFAULT_WASM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../target/wasm32-unknown-unknown/release/wasm_security_gate.wasm',
);

/**
 * WasmGateBridge — lifecycle-managed wrapper around the WASM security gate.
 *
 * Use `WasmGateBridge.create()` to load, instantiate, and initialize the gate.
 * The constructor is private; all setup is performed asynchronously in create().
 *
 * All call methods are synchronous after construction; WASM execution is
 * single-threaded and the scratch region is exclusively owned by this instance.
 */
export class WasmGateBridge {
  private readonly exports: GateExports;
  private readonly scratchOffset: number;

  private constructor(exports: GateExports, scratchOffset: number) {
    this.exports = exports;
    this.scratchOffset = scratchOffset;
  }

  /**
   * Load, compile, instantiate, and initialize the WASM security gate.
   *
   * @param wasmPath  Optional override for the .wasm binary path.
   *                  Defaults to the release build in the workspace target dir.
   */
  static async create(wasmPath?: string): Promise<WasmGateBridge> {
    const path = wasmPath ?? DEFAULT_WASM_PATH;
    const binary = await readFile(path);

    // Host imports required by the Rust gate (wasm32-unknown-unknown target).
    // host_monotonic_ns must return nanoseconds since a stable epoch.
    const importObject: WebAssembly.Imports = {
      env: {
        host_monotonic_ns: (): bigint => process.hrtime.bigint(),
      },
    };

    const module   = await WebAssembly.compile(binary);
    const instance = await WebAssembly.instantiate(module, importObject);
    const exports  = instance.exports as GateExports;

    // Initialize the gate state (must be called exactly once before any other export).
    const initRc = exports.gate_init();
    if (initRc !== RC_ALLOW) {
      throw new Error(`wasm gate_init failed with rc=${initRc} (${decodeRc(initRc).detail})`);
    }

    // Reserve a 64 KiB scratch page AFTER gate_init() so all internal heap
    // allocations from gate initialization are complete before we mark our region.
    // memory.grow() is atomic: returns old page count, size becomes old+1.
    const scratchPage = exports.memory.grow(1);
    if (scratchPage === -1) {
      throw new Error('Failed to allocate WASM scratch page');
    }
    const scratchOffset = scratchPage * 65536;

    return new WasmGateBridge(exports, scratchOffset);
  }

  /**
   * Pass a FlatBuffers-encoded SecurityRequest to the WASM gate.
   *
   * The bytes are written into the dedicated scratch page of WASM linear
   * memory, then process_security_request() is called with the scratch pointer.
   *
   * @param fbsBytes  Raw FlatBuffers bytes (application/octet-stream).
   *                  Must not exceed 64 KiB (MAX_MESSAGE_BYTES).
   */
  processSecurityRequest(fbsBytes: Uint8Array): RcDecision {
    if (fbsBytes.byteLength > MAX_SCRATCH_BYTES) {
      return {
        kind: 'error',
        code: RC_ERR_SIZE,
        detail: `buffer length ${fbsBytes.byteLength} exceeds 64 KiB scratch limit`,
      };
    }

    // Re-acquire view before each write: memory.buffer can be detached if
    // Rust's internal allocator has grown memory since the last call.
    new Uint8Array(this.exports.memory.buffer, this.scratchOffset, fbsBytes.byteLength)
      .set(fbsBytes);

    const rc = this.exports.process_security_request(
      this.scratchOffset,
      fbsBytes.byteLength,
    );
    return decodeRc(rc);
  }

  /**
   * Pass a FlatBuffers-encoded SignatureUpdate to the WASM gate.
   *
   * System 2 (the Sentinel) calls this to push new probabilistic fingerprints
   * into System 1's trusted fingerprint store.
   *
   * @param fbsBytes  Raw FlatBuffers bytes.  Must not exceed 64 KiB.
   */
  applySignatureUpdate(fbsBytes: Uint8Array): RcDecision {
    if (fbsBytes.byteLength > MAX_SCRATCH_BYTES) {
      return {
        kind: 'error',
        code: RC_ERR_SIZE,
        detail: `buffer length ${fbsBytes.byteLength} exceeds 64 KiB scratch limit`,
      };
    }

    new Uint8Array(this.exports.memory.buffer, this.scratchOffset, fbsBytes.byteLength)
      .set(fbsBytes);

    const rc = this.exports.apply_signature_update(
      this.scratchOffset,
      fbsBytes.byteLength,
    );
    return decodeRc(rc);
  }

  /**
   * True if the scratch region is still accessible (memory not detached by
   * an unexpected WebAssembly.Memory replacement).  Useful for health checks.
   */
  get isHealthy(): boolean {
    return this.exports.memory.buffer.byteLength > this.scratchOffset;
  }
}
