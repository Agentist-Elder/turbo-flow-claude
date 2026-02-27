//! System 1 — WASM Security Gate entry points.
//!
//! Target: `wasm32-unknown-unknown` (Node.js host).
//!
//! # Design principles
//! - **Default-deny**: any parse error, missing field, or failed check → `RC_DENY`.
//! - **Never learns natively**: all signature/fingerprint updates arrive from
//!   System 2 via `apply_signature_update`; the gate stores them but never
//!   derives them itself.
//! - **Single-threaded**: `thread_local!` + `RefCell` — no `Mutex` syscalls on
//!   `wasm32-unknown-unknown`.
//!
//! # Exported C ABI
//! | Symbol | Args | Returns |
//! |--------|------|---------|
//! | `gate_init` | — | `RC_ALLOW` or error sentinel |
//! | `process_security_request` | `ptr: u32, len: u32` | RC code |
//! | `apply_signature_update` | `ptr: u32, len: u32` | RC code |

mod config;
mod security_logic;

use std::cell::RefCell;

use flatbuffers::VerifierOptions;
use flatbuffers_schemas_rust::{
    common_generated::mothership::common::ProvenanceRecord,
    wasm_gate_generated::mothership::wasm_gate::{
        root_as_security_request_with_opts, SignatureUpdate,
    },
};
use rvf_memory_physics::ContinuousDeterministicMemory;

use config::{
    monotonic_now_ns, MAX_FINGERPRINTS, MAX_MESSAGE_BYTES, MAX_ORIGINS,
    MAX_VERIFIER_DEPTH, MAX_VERIFIER_TABLES,
};
use security_logic::{
    check_chain_height, check_embedding_len, check_freshness, check_message_size, verify_ed25519,
};

// ---------------------------------------------------------------------------
// Return codes (must match the host-side expectation)
// ---------------------------------------------------------------------------

/// Request passed all checks — allow.
pub const RC_ALLOW: u32 = 0;
/// Request failed a security check — deny.
pub const RC_DENY: u32 = 1;
/// Request is suspicious but not conclusively malicious — issue a challenge.
pub const RC_CHALLENGE: u32 = 2;
/// Request is quarantined for async analysis.
pub const RC_QUARANTINE: u32 = 3;

// Error sentinels (high byte = 0xFF so the host can distinguish from policy codes).
const RC_ERR_SIZE: u32 = 0xFFFF_FF01;
const RC_ERR_PARSE: u32 = 0xFFFF_FF02;
const RC_ERR_OOM: u32 = 0xFFFF_FF03;
const RC_ERR_STATE: u32 = 0xFFFF_FF04;

// ---------------------------------------------------------------------------
// Gate state types
// ---------------------------------------------------------------------------

/// Per-origin replay-protection record.
///
/// Keyed on `(origin_system, public_key)`.  Tracks the last accepted
/// timestamp and chain height to enforce strict monotonicity.
#[derive(Clone, Copy)]
struct OriginRecord {
    origin_system: u8,
    public_key: [u8; 32],
    last_timestamp_ns: u64,
    last_chain_height: u64,
    occupied: bool,
}

impl Default for OriginRecord {
    fn default() -> Self {
        Self {
            origin_system: 0,
            public_key: [0u8; 32],
            last_timestamp_ns: 0,
            last_chain_height: 0,
            occupied: false,
        }
    }
}

struct GateState {
    /// Circular buffer of per-origin replay records (FIFO eviction at capacity).
    origins: [OriginRecord; MAX_ORIGINS],
    /// Trusted `ProbabilisticFingerprint` store (FIFO eviction at `MAX_FINGERPRINTS`).
    fingerprints: Vec<[u8; 32]>,
    /// Pi-quantised memory for future adaptive scoring (placeholder).
    memory: ContinuousDeterministicMemory,
}

impl GateState {
    fn new() -> Self {
        Self {
            origins: [OriginRecord::default(); MAX_ORIGINS],
            fingerprints: Vec::with_capacity(MAX_FINGERPRINTS),
            memory: ContinuousDeterministicMemory::initialize(4),
        }
    }

    /// Find the slot index for `(system, pubkey)`, or `None`.
    fn find_origin(&self, system: u8, pubkey: &[u8; 32]) -> Option<usize> {
        self.origins
            .iter()
            .position(|r| r.occupied && r.origin_system == system && &r.public_key == pubkey)
    }

    /// Upsert an origin record, evicting slot 0 (oldest FIFO) when full.
    fn upsert_origin(&mut self, system: u8, pubkey: &[u8; 32], ts: u64, height: u64) {
        if let Some(idx) = self.find_origin(system, pubkey) {
            self.origins[idx].last_timestamp_ns = ts;
            self.origins[idx].last_chain_height = height;
            return;
        }
        let slot = self
            .origins
            .iter()
            .position(|r| !r.occupied)
            .unwrap_or(0); // evict oldest when full
        self.origins[slot] = OriginRecord {
            origin_system: system,
            public_key: *pubkey,
            last_timestamp_ns: ts,
            last_chain_height: height,
            occupied: true,
        };
    }

    /// Add a fingerprint, deduplicating and evicting the oldest at capacity.
    fn add_fingerprint(&mut self, fp: [u8; 32]) {
        if self.fingerprints.iter().any(|f| f == &fp) {
            return;
        }
        if self.fingerprints.len() >= MAX_FINGERPRINTS {
            self.fingerprints.remove(0); // FIFO eviction
        }
        self.fingerprints.push(fp);
    }
}

// ---------------------------------------------------------------------------
// Thread-local singleton (single-threaded wasm32 — no Mutex needed)
// ---------------------------------------------------------------------------

thread_local! {
    static STATE: RefCell<Option<GateState>> = RefCell::new(None);
}

// ---------------------------------------------------------------------------
// Shared verifier options (constructed inline — no heap allocation)
// ---------------------------------------------------------------------------

#[inline]
fn verifier_opts() -> VerifierOptions {
    VerifierOptions {
        max_apparent_size: MAX_MESSAGE_BYTES,
        max_depth: MAX_VERIFIER_DEPTH as usize,
        max_tables: MAX_VERIFIER_TABLES as usize,
        ..VerifierOptions::default()
    }
}

// ---------------------------------------------------------------------------
// Helper: run all guardrails for a ProvenanceRecord and update gate state.
//
// Returns an RC_* code.  On success, updates origin tracking in `state`.
// ---------------------------------------------------------------------------

fn validate_and_commit_provenance(
    prov: &ProvenanceRecord<'_>,
    state: &mut GateState,
    now_ns: u64,
) -> u32 {
    // Guardrail #1: ED25519 signature over (digest ‖ timestamp_ns).
    if verify_ed25519(prov).is_err() {
        return RC_DENY;
    }

    let ts = prov.timestamp_ns();
    let height = prov.witness_chain_height();
    let sys = prov.origin_system().0;
    let pubkey = match prov.public_key() {
        Some(k) => k.0,
        None => return RC_DENY,
    };

    let (last_ts, last_height) = match state.find_origin(sys, &pubkey) {
        Some(idx) => (
            state.origins[idx].last_timestamp_ns,
            state.origins[idx].last_chain_height,
        ),
        None => (0, 0),
    };

    // Guardrail #1: freshness + strict monotonicity.
    if check_freshness(ts, last_ts, now_ns).is_err() {
        return RC_DENY;
    }

    // Guardrail #1: chain height (unsigned field — separate from signature).
    if check_chain_height(height, last_height).is_err() {
        return RC_QUARANTINE;
    }

    // All checks passed — commit updated origin state.
    state.upsert_origin(sys, &pubkey, ts, height);
    RC_ALLOW
}

// ---------------------------------------------------------------------------
// WASM exports
// ---------------------------------------------------------------------------

/// Initialise the gate state.
///
/// MUST be called exactly once before any other export.
/// Returns `RC_ALLOW` (0) on success.
#[no_mangle]
pub extern "C" fn gate_init() -> u32 {
    STATE.with(|s| {
        *s.borrow_mut() = Some(GateState::new());
    });
    RC_ALLOW
}

/// Process an incoming `SecurityRequest` FlatBuffers buffer.
///
/// `ptr` and `len` describe a slice in WASM linear memory.  The host is
/// responsible for ensuring the slice is valid for the duration of this call.
///
/// Returns one of `RC_ALLOW`, `RC_DENY`, `RC_CHALLENGE`, `RC_QUARANTINE`, or
/// an `RC_ERR_*` sentinel on internal errors.
///
/// # Safety
/// `ptr..ptr+len` must be a valid slice in WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn process_security_request(ptr: u32, len: u32) -> u32 {
    let buf = core::slice::from_raw_parts(ptr as *const u8, len as usize);

    // Guardrail #2 — pre-parse size gate.
    if check_message_size(buf).is_err() {
        return RC_ERR_SIZE;
    }

    // Parse and structurally verify the FlatBuffers envelope.
    let opts = verifier_opts();
    let req = match root_as_security_request_with_opts(&opts, buf) {
        Ok(r) => r,
        Err(_) => return RC_ERR_PARSE,
    };

    // Guardrail #2 — post-parse embedding length gate.
    if let Some(ctx) = req.domain_context() {
        if check_embedding_len(&ctx).is_err() {
            return RC_ERR_OOM;
        }
    }

    let now_ns = monotonic_now_ns();

    STATE.with(|s| {
        let mut borrowed = s.borrow_mut();
        let state = match borrowed.as_mut() {
            Some(st) => st,
            None => return RC_ERR_STATE,
        };

        // Provenance is required — default-deny if absent.
        let prov = match req.provenance() {
            Some(p) => p,
            None => return RC_DENY,
        };

        validate_and_commit_provenance(&prov, state, now_ns)
    })
}

/// Apply a `SignatureUpdate` from System 2 (the Sentinel).
///
/// Merges new `ProbabilisticFingerprint` entries into the trusted fingerprint
/// store after verifying the update's own provenance.
///
/// Returns `RC_ALLOW` on success, or `RC_DENY` / `RC_ERR_*` on failure.
///
/// # Safety
/// `ptr..ptr+len` must be a valid slice in WASM linear memory.
#[no_mangle]
pub unsafe extern "C" fn apply_signature_update(ptr: u32, len: u32) -> u32 {
    let buf = core::slice::from_raw_parts(ptr as *const u8, len as usize);

    // Guardrail #2 — pre-parse size gate.
    if check_message_size(buf).is_err() {
        return RC_ERR_SIZE;
    }

    // SignatureUpdate is not the root_type so use flatbuffers::root_with_opts directly.
    let opts = verifier_opts();
    let update = match flatbuffers::root_with_opts::<SignatureUpdate<'_>>(&opts, buf) {
        Ok(u) => u,
        Err(_) => return RC_ERR_PARSE,
    };

    let now_ns = monotonic_now_ns();

    STATE.with(|s| {
        let mut borrowed = s.borrow_mut();
        let state = match borrowed.as_mut() {
            Some(st) => st,
            None => return RC_ERR_STATE,
        };

        // Verify the update's own provenance — default-deny if absent.
        let prov = match update.provenance() {
            Some(p) => p,
            None => return RC_DENY,
        };

        let rc = validate_and_commit_provenance(&prov, state, now_ns);
        if rc != RC_ALLOW {
            return rc;
        }

        // Merge new fingerprints into the trusted store.
        if let Some(sigs) = update.new_signatures() {
            for fp in sigs.iter() {
                state.add_fingerprint(fp.0);
            }
        }

        RC_ALLOW
    })
}
