//! Compile-time configuration and platform clock abstraction.
//!
//! All size/depth limits and freshness windows are collected here so that
//! the security team can audit and update them in a single location.

// ---------------------------------------------------------------------------
// Size / depth limits  (Red Team guardrail #2 — OOM defense)
// ---------------------------------------------------------------------------

/// Maximum incoming FlatBuffers message size (bytes).
///
/// Rejected *before* the FlatBuffers verifier even inspects the buffer.
/// A conforming SecurityRequest is well under 8 KiB; 64 KiB is generous.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024; // 64 KiB

/// Maximum FlatBuffers table-nesting depth the Verifier will traverse.
///
/// Limits call-stack depth inside the FlatBuffers verifier on Pi Zero.
pub const MAX_VERIFIER_DEPTH: u32 = 16;

/// Maximum number of FlatBuffers tables the Verifier will visit per message.
///
/// Limits CPU/stack consumption from adversarially constructed messages.
pub const MAX_VERIFIER_TABLES: u32 = 100;

/// Maximum DomainContext embedding vector length (element count, not bytes).
///
/// Schema specifies 768 float32 elements (~3 KiB).  Anything larger than
/// this cap is an adversarial or malformed message; reject before iteration.
pub const MAX_EMBEDDING_LEN: usize = 1_024;

// ---------------------------------------------------------------------------
// Replay-protection parameters  (Red Team guardrail #1)
// ---------------------------------------------------------------------------

/// Freshness window for ProvenanceRecord timestamps (nanoseconds).
///
/// A ProvenanceRecord whose `timestamp_ns` is older than this relative to
/// the gate's monotonic clock is rejected, even if the signature is valid.
/// 30 s tolerates realistic clock skew while bounding replay windows.
pub const FRESHNESS_WINDOW_NS: u64 = 30_000_000_000; // 30 s

/// Maximum number of distinct (origin, public_key) pairs the gate tracks
/// for per-origin replay prevention.  Oldest entry is evicted when full.
pub const MAX_ORIGINS: usize = 8;

// ---------------------------------------------------------------------------
// Fingerprint store
// ---------------------------------------------------------------------------

/// Maximum number of trusted ProbabilisticFingerprint entries the gate holds.
///
/// Bounded to prevent unbounded growth from rogue SignatureUpdate messages.
pub const MAX_FINGERPRINTS: usize = 256;

// ---------------------------------------------------------------------------
// Post-quantum signature validation  (Red Team guardrail #4)
// ---------------------------------------------------------------------------

/// Expected byte length of a non-empty `pq_signature` field.
///
/// Set to 0 to disable length validation during bootstrap (no PQ hardware CA
/// attached yet).  Set to 3 293 for CRYSTALS-Dilithium 3 in production.
#[allow(dead_code)]
pub const EXPECTED_PQ_SIG_LEN: usize = 0; // bootstrap: validation disabled

// ---------------------------------------------------------------------------
// Monotonic clock abstraction
// ---------------------------------------------------------------------------

/// Host-provided monotonic clock import (wasm32-unknown-unknown target).
///
/// The WASM host MUST register this import before calling `gate_init`.
/// It must return nanoseconds since an arbitrary but stable epoch.
#[cfg(target_arch = "wasm32")]
extern "C" {
    pub fn host_monotonic_ns() -> u64;
}

/// Return the current monotonic time in nanoseconds.
///
/// On `wasm32-unknown-unknown` delegates to the host import.
/// On native targets uses `SystemTime` (for unit testing only).
#[inline]
pub fn monotonic_now_ns() -> u64 {
    #[cfg(target_arch = "wasm32")]
    {
        // SAFETY: host_monotonic_ns is a WASM import; the host is contractually
        // required to provide it.  No Rust memory is accessed.
        unsafe { host_monotonic_ns() }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    }
}
