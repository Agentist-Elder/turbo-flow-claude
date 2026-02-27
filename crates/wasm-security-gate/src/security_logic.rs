//! Security logic — four Red Team guardrails.
//!
//! Each function corresponds to exactly one guardrail so the security team
//! can audit, test, and update them in isolation.
//!
//! | # | Guardrail          | Functions |
//! |---|--------------------|-----------|
//! | 1 | Replay protection  | `check_freshness`, `check_chain_height`, `verify_ed25519` |
//! | 2 | OOM defense        | `check_message_size`, `check_embedding_len` |
//! | 3 | 128-bit collision  | `xxh3_digest_eq` |
//! | 4 | PQ sig bounds      | `validate_pq_signature` |

use flatbuffers_schemas_rust::common_generated::mothership::common::{
    DomainContext, ProvenanceRecord, Xxh3Digest,
};

use crate::config::{
    EXPECTED_PQ_SIG_LEN, FRESHNESS_WINDOW_NS, MAX_EMBEDDING_LEN, MAX_MESSAGE_BYTES,
};

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SizeError {
    MessageTooLarge { got: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OomError {
    EmbeddingTooLong { got: usize },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProvenanceError {
    MissingContentDigest,
    MissingSignature,
    MissingPublicKey,
    /// The ED25519 public key bytes are not on the curve.
    InvalidPublicKey,
    /// The ED25519 signature does not verify.
    InvalidSignature,
    /// Timestamp is older than FRESHNESS_WINDOW_NS relative to the gate clock.
    StaleTimestamp,
    /// Timestamp is not strictly greater than the last-seen value for this origin.
    NonMonotonicTimestamp,
    /// `witness_chain_height` regressed (unsigned field — checked independently).
    ChainHeightRegressed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PqSigError {
    InvalidLength { got: usize, expected: usize },
}

// ---------------------------------------------------------------------------
// Guardrail #2 — OOM defense
// ---------------------------------------------------------------------------

/// Reject buffers exceeding the pre-parse byte cap (guardrail #2 — pre-parse).
///
/// Called **before** the FlatBuffers verifier; an adversarially large buffer
/// never reaches the parser.
#[inline]
pub fn check_message_size(buf: &[u8]) -> Result<(), SizeError> {
    if buf.len() > MAX_MESSAGE_BYTES {
        return Err(SizeError::MessageTooLarge { got: buf.len() });
    }
    Ok(())
}

/// Reject a parsed `DomainContext` whose embedding vector exceeds the cap
/// (guardrail #2 — post-parse).
pub fn check_embedding_len(ctx: &DomainContext<'_>) -> Result<(), OomError> {
    if let Some(emb) = ctx.embedding() {
        if emb.len() > MAX_EMBEDDING_LEN {
            return Err(OomError::EmbeddingTooLong { got: emb.len() });
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Guardrail #3 — full 128-bit collision defense
// ---------------------------------------------------------------------------

/// Compare two `Xxh3Digest` values using ALL 128 bits (guardrail #3).
///
/// Both `.lo()` (bits 63:0) **and** `.hi()` (bits 127:64) must match.
/// Comparing only `lo` exposes a 64-bit birthday attack (~2³² work).
#[inline]
pub fn xxh3_digest_eq(a: &Xxh3Digest, b: &Xxh3Digest) -> bool {
    a.lo() == b.lo() && a.hi() == b.hi()
}

// ---------------------------------------------------------------------------
// Guardrail #1 — replay protection
// ---------------------------------------------------------------------------

/// Check timestamp freshness and strict monotonicity (guardrail #1).
///
/// Two independent tests:
/// 1. **Freshness window** — `timestamp_ns` must be within `FRESHNESS_WINDOW_NS`
///    (30 s) of `now_ns`.  Tolerates realistic clock skew while bounding replays.
/// 2. **Strict monotonicity** — `timestamp_ns` must be strictly greater than
///    `last_seen_ts_ns` for this (origin, public_key) pair, preventing exact
///    replay of a still-fresh message.
pub fn check_freshness(
    timestamp_ns: u64,
    last_seen_ts_ns: u64,
    now_ns: u64,
) -> Result<(), ProvenanceError> {
    let age = now_ns.saturating_sub(timestamp_ns);
    if age > FRESHNESS_WINDOW_NS {
        return Err(ProvenanceError::StaleTimestamp);
    }
    if timestamp_ns <= last_seen_ts_ns {
        return Err(ProvenanceError::NonMonotonicTimestamp);
    }
    Ok(())
}

/// Check that `witness_chain_height` is strictly increasing (guardrail #1).
///
/// **Why separate from `verify_ed25519`**: `witness_chain_height` is
/// intentionally NOT included in the ED25519-signed envelope so the
/// Decoupled Hardware CA can update it without re-signing.  An attacker who
/// zeroes this field passes the signature check but fails here.
///
/// `last_seen == 0` means "first-ever message from this origin" and is always
/// accepted regardless of `current`.
pub fn check_chain_height(current: u64, last_seen: u64) -> Result<(), ProvenanceError> {
    if last_seen != 0 && current <= last_seen {
        return Err(ProvenanceError::ChainHeightRegressed);
    }
    Ok(())
}

/// Verify the ED25519 signature on a `ProvenanceRecord` (guardrail #1).
///
/// **Signed message** (24 bytes, deterministic):
/// ```text
/// content_digest.0[0..16]    XXH3-128 bytes (little-endian layout)
/// timestamp_ns.to_le_bytes() u64, 8 bytes
/// ```
///
/// `witness_chain_height` is excluded from the signed message (see
/// [`check_chain_height`] for rationale).
///
/// Uses `verify_strict` which rejects low-order-component malleability.
pub fn verify_ed25519(record: &ProvenanceRecord<'_>) -> Result<(), ProvenanceError> {
    use ed25519_dalek::{Signature, VerifyingKey};

    let digest = record
        .content_digest()
        .ok_or(ProvenanceError::MissingContentDigest)?;
    let sig_raw = record
        .signature()
        .ok_or(ProvenanceError::MissingSignature)?;
    let pub_key_raw = record
        .public_key()
        .ok_or(ProvenanceError::MissingPublicKey)?;

    let timestamp_ns = record.timestamp_ns();

    // 24-byte signed message: 16-byte digest ‖ 8-byte timestamp LE.
    let mut msg = [0u8; 24];
    msg[..16].copy_from_slice(&digest.0);
    msg[16..].copy_from_slice(&timestamp_ns.to_le_bytes());

    let vk = VerifyingKey::from_bytes(&pub_key_raw.0)
        .map_err(|_| ProvenanceError::InvalidPublicKey)?;
    let sig = Signature::from_bytes(&sig_raw.0);

    vk.verify_strict(&msg, &sig)
        .map_err(|_| ProvenanceError::InvalidSignature)
}

// ---------------------------------------------------------------------------
// Guardrail #4 — post-quantum signature bounds
// ---------------------------------------------------------------------------

/// Validate the byte length of an optional PQ signature field (guardrail #4).
///
/// - **Absent or empty**: always accepted (bootstrap / classical-only).
/// - **`EXPECTED_PQ_SIG_LEN == 0`**: validation disabled; any length accepted.
/// - **Non-empty, `EXPECTED_PQ_SIG_LEN > 0`**: must equal exactly
///   `EXPECTED_PQ_SIG_LEN`.  A truncated or padded PQ sig indicates tampering.
pub fn validate_pq_signature(pq_sig: Option<&[u8]>) -> Result<(), PqSigError> {
    if EXPECTED_PQ_SIG_LEN == 0 {
        return Ok(()); // bootstrap: length validation disabled
    }
    let bytes = match pq_sig {
        None => return Ok(()),
        Some(b) => b,
    };
    if bytes.is_empty() {
        return Ok(());
    }
    if bytes.len() != EXPECTED_PQ_SIG_LEN {
        return Err(PqSigError::InvalidLength {
            got: bytes.len(),
            expected: EXPECTED_PQ_SIG_LEN,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use flatbuffers_schemas_rust::common_generated::mothership::common::Xxh3Digest;

    // --- Guardrail #2 ---

    #[test]
    fn message_size_at_cap_is_accepted() {
        let buf = vec![0u8; MAX_MESSAGE_BYTES];
        assert!(check_message_size(&buf).is_ok());
    }

    #[test]
    fn message_size_one_over_cap_is_rejected() {
        let buf = vec![0u8; MAX_MESSAGE_BYTES + 1];
        assert!(matches!(
            check_message_size(&buf),
            Err(SizeError::MessageTooLarge { got }) if got == MAX_MESSAGE_BYTES + 1
        ));
    }

    // --- Guardrail #3 ---

    #[test]
    fn xxh3_different_hi_is_not_equal() {
        // Two digests that share lo but differ in hi — only 128-bit compare catches this.
        let mut a = Xxh3Digest([0u8; 16]);
        let mut b = Xxh3Digest([0u8; 16]);
        a.0[8] = 0xAA; // hi lives in bytes [8..16]
        b.0[8] = 0xBB;
        assert!(!xxh3_digest_eq(&a, &b));
    }

    #[test]
    fn xxh3_identical_bytes_are_equal() {
        let a = Xxh3Digest([0x42u8; 16]);
        let b = Xxh3Digest([0x42u8; 16]);
        assert!(xxh3_digest_eq(&a, &b));
    }

    // --- Guardrail #1: freshness ---

    #[test]
    fn fresh_monotonic_timestamp_is_accepted() {
        let now = 60_000_000_000u64; // 60 s
        let ts = now - 1_000_000; // 1 ms old
        assert!(check_freshness(ts, 0, now).is_ok());
    }

    #[test]
    fn stale_timestamp_is_rejected() {
        let now = 60_000_000_000u64;
        let ts = 0u64; // 60 s old — exceeds 30 s window
        assert!(matches!(
            check_freshness(ts, 0, now),
            Err(ProvenanceError::StaleTimestamp)
        ));
    }

    #[test]
    fn replay_of_same_timestamp_is_rejected() {
        let now = 60_000_000_000u64;
        let ts = now - 1_000_000;
        assert!(check_freshness(ts, 0, now).is_ok());
        // Replay with identical timestamp must fail.
        assert!(matches!(
            check_freshness(ts, ts, now),
            Err(ProvenanceError::NonMonotonicTimestamp)
        ));
    }

    // --- Guardrail #1: chain height ---

    #[test]
    fn chain_height_first_message_is_accepted() {
        assert!(check_chain_height(0, 0).is_ok());
        assert!(check_chain_height(1, 0).is_ok());
    }

    #[test]
    fn chain_height_regression_is_rejected() {
        assert!(matches!(
            check_chain_height(5, 10),
            Err(ProvenanceError::ChainHeightRegressed)
        ));
    }

    #[test]
    fn chain_height_equal_is_rejected() {
        assert!(matches!(
            check_chain_height(10, 10),
            Err(ProvenanceError::ChainHeightRegressed)
        ));
    }

    // --- Guardrail #4 ---

    #[test]
    fn pq_sig_absent_is_accepted() {
        assert!(validate_pq_signature(None).is_ok());
    }

    #[test]
    fn pq_sig_empty_slice_is_accepted() {
        assert!(validate_pq_signature(Some(&[])).is_ok());
    }

    #[test]
    fn pq_sig_bootstrap_mode_accepts_any_length() {
        assert_eq!(EXPECTED_PQ_SIG_LEN, 0, "test assumes bootstrap/disabled mode");
        assert!(validate_pq_signature(Some(&[0u8; 3293])).is_ok());
        assert!(validate_pq_signature(Some(&[0u8; 1])).is_ok());
    }
}
