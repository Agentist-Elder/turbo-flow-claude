//! Bunker Strategy v1 — Infrastructure Trust Gap Defensive Skeleton
//!
//! Phase D: `cargo check`-passing stubs only. No logic implemented.
//! See docs/research/Bunker-Strategy-v1.manifest.md for the full spec.
//!
//! Modules:
//!   jit_provenance   — HONESTCUE: VC-based provenance for JIT-generated code
//!   did_passport     — UNC2970:   DID Passport identity verification
//!   endpoint_monitor — Runtime:   macOS ESF behavioural monitoring (cfg-gated)
//!   artifact_verifier — Supply chain: Sigstore artifact signature verification

pub mod jit_provenance;
pub mod did_passport;
pub mod endpoint_monitor;
pub mod artifact_verifier;
