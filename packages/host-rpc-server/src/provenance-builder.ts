/**
 * Phase 8 — Provenance Builder (Node.js built-in crypto only)
 *
 * Builds a FlatBuffers-encoded SecurityRequest with a valid ED25519 ProvenanceRecord.
 * All cryptographic operations use `node:crypto`; no external libraries.
 *
 * Signed message (24 bytes, matches wasm-security-gate `verify_ed25519`):
 *   bytes  0..16: raw Xxh3Digest bytes  (content_digest.0 in Rust)
 *   bytes 16..24: timestamp_ns as little-endian u64
 *
 * The gate uses ed25519-dalek `verify_strict` which is standard RFC 8032 Ed25519,
 * compatible with Node's `crypto.sign(null, msg, privateKey)`.
 *
 * FlatBuffers inline-struct rule:
 *   Each `createXxx` struct must be called IMMEDIATELY before its `addFieldStruct`,
 *   because the `nested(offset)` check verifies the struct is at the current
 *   buffer tip when `addFieldStruct` is invoked.
 */

import { sign as cryptoSign, KeyObject } from 'node:crypto';
import { Builder } from 'flatbuffers';

import { ProvenanceRecord } from '../../flatbuffers-schemas-ts/src/mothership/common/provenance-record.js';
import { Xxh3Digest } from '../../flatbuffers-schemas-ts/src/mothership/common/xxh3-digest.js';
import { Ed25519Signature } from '../../flatbuffers-schemas-ts/src/mothership/common/ed25519-signature.js';
import { Ed25519PublicKey } from '../../flatbuffers-schemas-ts/src/mothership/common/ed25519-public-key.js';
import { SecurityRequest } from '../../flatbuffers-schemas-ts/src/mothership/wasm-gate/security-request.js';
import { SystemId } from '../../flatbuffers-schemas-ts/src/mothership/common/system-id.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Read 8 bytes from `bytes[offset..offset+8]` as a little-endian uint64 BigInt. */
function readUint64LE(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 0; i < 8; i++) {
    v |= BigInt(bytes[offset + i]!) << BigInt(i * 8);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SignedRequestOptions {
  /** Request identifier (must be monotonically increasing per caller). */
  requestId: bigint;

  /**
   * Raw 16-byte content hash (Xxh3Digest).
   * These bytes appear verbatim in the signed message as `content_digest.0[0..16]`.
   */
  contentDigest: Uint8Array;

  /** ED25519 private KeyObject (from `generateKeypair().privateKey`). */
  privateKey: KeyObject;

  /**
   * Raw 32-byte public key bytes (from `generateKeypair().publicKeyBytes`).
   * Used to populate the FlatBuffers `Ed25519PublicKey` struct.
   */
  publicKeyBytes: Uint8Array;

  /**
   * Nanosecond monotonic timestamp.
   * Defaults to `process.hrtime.bigint()` — the same clock the gate uses.
   * Must fall within 30 s of the gate's current time.
   */
  timestampNs?: bigint;

  /**
   * Witness chain height.
   * Defaults to 0n, which is always accepted for a first-seen origin.
   */
  witnessChainHeight?: bigint;

  /** Origin system.  Defaults to `SystemId.UnixAdaptiveSentinel`. */
  originSystem?: SystemId;
}

/**
 * Build a FlatBuffers-encoded SecurityRequest carrying a valid ED25519 ProvenanceRecord.
 *
 * The gate will return RC_ALLOW if:
 *   - the timestamp is fresh (within 30 s of gate time),
 *   - this is the first message from this (originSystem, publicKey) pair, AND
 *   - the ED25519 signature verifies.
 *
 * @returns Raw `Uint8Array` for `WasmGateBridge.processSecurityRequest`.
 */
export function buildSignedSecurityRequest(opts: SignedRequestOptions): Uint8Array {
  const timestampNs       = opts.timestampNs       ?? process.hrtime.bigint();
  const originSystem      = opts.originSystem       ?? SystemId.UnixAdaptiveSentinel;
  const witnessChainHeight = opts.witnessChainHeight ?? 0n;

  // --- Build the 24-byte signed message ---
  const msg = new Uint8Array(24);
  msg.set(opts.contentDigest.subarray(0, 16), 0);
  const tsView = new DataView(msg.buffer, msg.byteOffset + 16, 8);
  tsView.setUint32(0, Number(timestampNs & 0xFFFF_FFFFn),         /* LE */ true);
  tsView.setUint32(4, Number((timestampNs >> 32n) & 0xFFFF_FFFFn), /* LE */ true);

  // --- Sign with Node's native ED25519 (RFC 8032, compatible with ed25519-dalek) ---
  const sigBuf = cryptoSign(null, msg, opts.privateKey);
  const sigBytes = new Uint8Array(sigBuf.buffer, sigBuf.byteOffset, sigBuf.byteLength);

  // --- Pre-compute uint64 LE values for FlatBuffers struct fields ---
  const digestLo = readUint64LE(opts.contentDigest, 0);
  const digestHi = readUint64LE(opts.contentDigest, 8);

  const pk0 = readUint64LE(opts.publicKeyBytes,  0);
  const pk1 = readUint64LE(opts.publicKeyBytes,  8);
  const pk2 = readUint64LE(opts.publicKeyBytes, 16);
  const pk3 = readUint64LE(opts.publicKeyBytes, 24);

  const s0 = readUint64LE(sigBytes,  0);  const s1 = readUint64LE(sigBytes,  8);
  const s2 = readUint64LE(sigBytes, 16);  const s3 = readUint64LE(sigBytes, 24);
  const s4 = readUint64LE(sigBytes, 32);  const s5 = readUint64LE(sigBytes, 40);
  const s6 = readUint64LE(sigBytes, 48);  const s7 = readUint64LE(sigBytes, 56);

  // --- Assemble FlatBuffers message ---
  //
  // Rule: each `createXxx` MUST be called IMMEDIATELY before its `addFieldStruct`
  // so the builder's inline `nested(offset)` check passes.

  const b = new Builder(512);

  // Inner table: ProvenanceRecord (must be fully built before SecurityRequest).
  ProvenanceRecord.startProvenanceRecord(b);
  ProvenanceRecord.addOriginSystem(b, originSystem);
  ProvenanceRecord.addContentDigest(b, Xxh3Digest.createXxh3Digest(b, digestLo, digestHi));
  ProvenanceRecord.addSignature(b, Ed25519Signature.createEd25519Signature(
    b, s0, s1, s2, s3, s4, s5, s6, s7,
  ));
  ProvenanceRecord.addPublicKey(b, Ed25519PublicKey.createEd25519PublicKey(
    b, pk0, pk1, pk2, pk3,
  ));
  ProvenanceRecord.addTimestampNs(b, timestampNs);
  ProvenanceRecord.addWitnessChainHeight(b, witnessChainHeight);
  const provenanceOffset = ProvenanceRecord.endProvenanceRecord(b);

  // Outer table: SecurityRequest.
  SecurityRequest.startSecurityRequest(b);
  SecurityRequest.addRequestId(b, opts.requestId);
  SecurityRequest.addProvenance(b, provenanceOffset);
  SecurityRequest.addTimestampNs(b, timestampNs);
  const reqOffset = SecurityRequest.endSecurityRequest(b);
  SecurityRequest.finishSecurityRequestBuffer(b, reqOffset);

  return b.asUint8Array();
}
