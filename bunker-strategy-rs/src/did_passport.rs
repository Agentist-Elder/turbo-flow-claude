//! UNC2970 Defence — DID Passport identity verification.
//!
//! Phase D stubs. All function bodies are unimplemented.
//! UNVERIFIED markers indicate API shapes that must be confirmed by cargo check.

use serde::{Deserialize, Serialize};

/// Employment claim issued by a trusted employer (Issuer) to an applicant (Holder).
/// Presented as part of a Verifiable Presentation to a recruitment platform (Verifier).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmploymentCredentialSubject {
    /// Applicant's DID — matches the VP holder DID
    pub id: String,
    pub employer_name: String,
    pub job_title: String,
    /// ISO 8601 date
    pub start_date: String,
    /// ISO 8601 date, None if currently employed
    pub end_date: Option<String>,
    pub responsibilities: Vec<String>,
    /// Must be true for the VC to pass recruitment platform policy
    pub verified_by_hr: bool,
}

/// Error type for passport operations.
pub type PassportError = Box<dyn std::error::Error + Send + Sync>;

/// Employer (Issuer) issues a signed employment VC to an applicant DID.
///
/// In Phase I this signs with a real Issuer DID and persists the VC.
/// In Phase D this is a stub.
///
/// UNVERIFIED: `ssi::jwk::JWK` path and VC return type.
pub async fn issue_employment_vc(
    _applicant_did: &str,
    _employer_name: &str,
    _job_title: &str,
    _start_date: &str,
    _end_date: Option<&str>,
    _responsibilities: Vec<String>,
    _issuer_jwk: &ssi::jwk::JWK,
) -> Result<serde_json::Value, PassportError> {
    // Phase D stub — returns vc_as_json_value
    // Real ssi VC type replaces serde_json::Value in Phase I
    Err("Phase D stub — not implemented".into())
}

/// Recruitment platform (Verifier) verifies a Verifiable Presentation.
///
/// Checks (all must pass):
///   1. Cryptographic signature on VP (holder signed it)
///   2. VP holder DID matches applicant_did
///   3. Each VC in the VP has a trusted issuer DID
///   4. Each VC subject DID matches applicant_did
///   5. verified_by_hr == true on employment credentials
///
/// UNVERIFIED: VP parameter type — serde_json::Value is a placeholder.
pub async fn verify_applicant_vp(
    _applicant_did: &str,
    _vp: &serde_json::Value,
    _trusted_issuers: &[String],
) -> Result<(), PassportError> {
    // Phase D stub
    Err("Phase D stub — not implemented".into())
}
