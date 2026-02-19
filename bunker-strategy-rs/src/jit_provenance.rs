//! HONESTCUE Defence — VC-based provenance for JIT-generated code.
//!
//! Phase D stubs. All function bodies are unimplemented.
//! UNVERIFIED markers indicate API shapes that must be confirmed by cargo check.

use serde::{Deserialize, Serialize};

/// Provenance claim attached to every JIT-generated code snippet.
/// Issued by the trusted JIT proxy; verified by the runtime before execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JitCodeProvenanceSubject {
    /// Unique identifier: "urn:jit:code:sha256:<hex-hash-of-code>"
    pub id: String,
    /// Language of generated code, e.g. "C#"
    pub code_type: String,
    /// Upstream API that produced the code, e.g. "Gemini"
    pub source_api: String,
    /// The exact prompt that was sent to the API
    pub generation_prompt: String,
    /// RFC3339 timestamp of generation
    pub generated_at: String,
    /// Policy tags applied by the proxy, e.g. ["approved-purpose"] or ["malicious-intent"]
    pub policy_tags: Vec<String>,
}

/// Error type for provenance operations.
pub type ProvenanceError = Box<dyn std::error::Error + Send + Sync>;

/// JIT proxy: simulate generating code and issue a VC binding the hash to the prompt.
///
/// In Phase I this will call the real Gemini API and sign with a real issuer DID.
/// In Phase D this is a stub — the signature proves the interface compiles.
///
/// UNVERIFIED: `ssi::jwk::JWK` path and `.sign()` method signature.
pub async fn generate_jit_logic_with_vc(
    _logic_prompt: &str,
    _issuer_jwk: &ssi::jwk::JWK,
) -> Result<(String, serde_json::Value), ProvenanceError> {
    // Phase D stub — returns (generated_code, vc_as_json_value)
    // The VC type will be replaced with the real ssi VC type in Phase I
    // once the correct ssi imports are confirmed by cargo check.
    Err("Phase D stub — not implemented".into())
}

/// Runtime verifier: cryptographic check + policy enforcement on a JIT code VC.
///
/// Policy checks:
///   - Issuer DID must be in the trusted set
///   - policy_tags must not contain "malicious-intent"
///   - generation_prompt must not contain blocked keywords
///
/// UNVERIFIED: vc parameter type — serde_json::Value is a placeholder until
/// the real ssi VC type path is confirmed.
pub async fn verify_jit_code_vc_and_policy(
    _vc: &serde_json::Value,
    _trusted_issuer_did: &str,
) -> Result<(), ProvenanceError> {
    // Phase D stub
    Err("Phase D stub — not implemented".into())
}
