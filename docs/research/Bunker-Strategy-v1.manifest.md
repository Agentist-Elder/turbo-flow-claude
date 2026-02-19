# Bunker Strategy v1 — Phase D Instruction Manifest

> Source ADR: `docs/research/Bunker-Strategy-v1.md`
> Phase: D (Design) — produce a `cargo check`-passing Rust skeleton
> Generated: 2026-02-19
> Next phase: I (Implementation) — fill stubs with real logic

---

## Prime Directive

Build a Rust project that passes `cargo check` on the target platform.
**Do not implement logic. Do not deviate from the crates and versions below.**
Mark every API call whose exact shape is unverified with `// UNVERIFIED`.

---

## Crate Manifest (versions confirmed from live docs.rs fetch 2026-02-19)

```toml
[package]
name = "bunker-strategy"
version = "0.1.0"
edition = "2021"

[dependencies]
# DID creation, VC/VP issuance and verification
# UNVERIFIED feature flags — run `cargo check` and adjust from errors
ssi = { version = "0.14.0", features = ["ed25519", "secp256k1", "p256"] }

# macOS Endpoint Security framework — AUTH/NOTIFY events
# UNVERIFIED: conditional dependency only, skip on Linux
[target.'cfg(target_os = "macos")'.dependencies]
endpoint-sec = "0.4.3"

[dependencies]
# Sigstore artifact signature verification (no signing in Phase D)
sigstore = { version = "0.13.0", features = [] }  # UNVERIFIED feature flags

# Supporting crates (likely already pulled in by ssi — add only if needed)
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sha2 = "0.10"
hex = "0.4"
chrono = { version = "0.4", features = ["serde"] }
```

**Known risk:** `ssi 0.14.0` is a large crate with many sub-crates (`ssi-core`,
`ssi-jwk`, `ssi-dids`, `ssi-claims`). The top-level `ssi` re-export may not
expose all types in the pseudocode. If `cargo check` errors show unknown paths,
check whether the type lives in a sub-crate that needs a direct dependency.

---

## Target File Structure

```
bunker-strategy-rs/
  Cargo.toml
  src/
    lib.rs                   ← pub mod declarations, no logic
    jit_provenance.rs        ← HONESTCUE: VC issuance/verification for JIT code
    did_passport.rs          ← UNC2970: VP creation/verification for identity
    endpoint_monitor.rs      ← macOS ESF event handler stubs (cfg-gated)
    artifact_verifier.rs     ← sigstore artifact signature verification stub
```

The project lives at `bunker-strategy-rs/` in the workspace root, alongside
`agentdb-rust-prime/`. It is a library crate (no `main.rs`) so `cargo check`
is the correct verification command.

---

## Interface Shapes

These are the **public function signatures Phase D must produce**. All bodies
are stubs — `Ok(Default::default())`, `Err("stub".into())`, or `todo!()`.
The signatures themselves are what matters for `cargo check`.

### `jit_provenance.rs` — HONESTCUE defence

```rust
use serde::{Serialize, Deserialize};

/// Provenance claim attached to every JIT-generated code snippet.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JitCodeProvenanceSubject {
    pub id: String,                  // "urn:jit:code:sha256:<hash>"
    pub code_type: String,           // "C#"
    pub source_api: String,          // "Gemini"
    pub generation_prompt: String,
    pub generated_at: String,        // RFC3339
    pub policy_tags: Vec<String>,    // ["approved-purpose"] or ["malicious-intent"]
}

/// JIT proxy: generate code stub + issue a VC binding hash to prompt.
/// Returns (generated_code, signed_vc).
/// UNVERIFIED: return type — replace /* VC */ with the real ssi VC type.
pub async fn generate_jit_logic_with_vc(
    logic_prompt: &str,
    issuer_jwk: &ssi::jwk::JWK,             // UNVERIFIED: path
) -> Result<(String, /* VC type */), Box<dyn std::error::Error>>;

/// Runtime verifier: cryptographic check + policy check on a JIT code VC.
/// UNVERIFIED: vc type, resolver trait bound.
pub async fn verify_jit_code_vc_and_policy(
    vc: &/* VC type */,
    resolver: &impl /* DIDResolver */,
    trusted_issuer_did: &str,
) -> Result<(), Box<dyn std::error::Error>>;
```

### `did_passport.rs` — UNC2970 defence

```rust
use serde::{Serialize, Deserialize};

/// Employment claim issued by a trusted employer (Issuer) to an applicant (Holder).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmploymentCredentialSubject {
    pub id: String,                    // Applicant's DID
    pub employer_name: String,
    pub job_title: String,
    pub start_date: String,
    pub end_date: Option<String>,
    pub responsibilities: Vec<String>,
    pub verified_by_hr: bool,
}

/// Employer (Issuer) issues a signed employment VC to an applicant DID.
/// UNVERIFIED: return type — replace /* EmploymentVC */ with real ssi type.
pub async fn issue_employment_vc(
    applicant_did: &str,
    employer_name: &str,
    job_title: &str,
    start_date: &str,
    end_date: Option<&str>,
    responsibilities: Vec<String>,
    issuer_jwk: &ssi::jwk::JWK,        // UNVERIFIED: path
) -> Result</* EmploymentVC */, Box<dyn std::error::Error>>;

/// Recruitment platform (Verifier) verifies a Verifiable Presentation.
/// Checks: cryptographic signature, holder DID match, issuer trust, HR flag.
/// UNVERIFIED: vp type, resolver trait bound.
pub async fn verify_applicant_vp(
    applicant_did: &str,
    vp: &/* VP type */,
    resolver: &impl /* DIDResolver */,
    trusted_issuers: &[String],
) -> Result<(), Box<dyn std::error::Error>>;
```

### `endpoint_monitor.rs` — Runtime behavioural detection

```rust
/// Subscribe to AUTH_EXEC, NOTIFY_MMAP, NOTIFY_MPROTECT events.
/// Returns an opaque client handle that stays alive as long as monitoring runs.
/// cfg-gated: real on macOS, stub on everything else.
#[cfg(target_os = "macos")]
pub fn build_es_client() -> Result</* endpoint_sec::Client */, Box<dyn std::error::Error>>;

#[cfg(not(target_os = "macos"))]
pub fn build_es_client() -> Result<(), Box<dyn std::error::Error>> {
    Err("endpoint-sec requires macOS with ESF entitlement".into())
}

/// Event handler: called by the ESF client for each subscribed event.
/// Policy: deny execution from /tmp/, alert on W->X mprotect transitions.
/// UNVERIFIED: exact message type from endpoint-sec 0.4.3.
#[cfg(target_os = "macos")]
pub fn handle_es_event(message: *const /* es_message_t */);
```

### `artifact_verifier.rs` — Supply chain trust

```rust
use std::path::Path;

/// Verify that a local artifact has a valid Sigstore/Rekor signature.
/// Returns Ok(true) if verified, Ok(false) if no signature found,
/// Err if verification infrastructure unreachable.
/// UNVERIFIED: sigstore 0.13.0 verification API path.
pub async fn verify_artifact_signature(
    artifact_path: &Path,
) -> Result<bool, Box<dyn std::error::Error>>;
```

---

## Phase D Success Criteria

| Check | Pass condition |
|---|---|
| `cargo check` | Zero errors |
| `cargo check --target x86_64-unknown-linux-gnu` | Zero errors (endpoint-sec stubbed) |
| All public signatures present | Every function above exists with correct name |
| No logic implemented | Stubs only — no real signing, no real API calls |
| UNVERIFIED markers present | Uncertain API shapes are annotated, not silently guessed |

---

## Explicit Out-of-Scope for Phase D

- JIT proxy logic (real Gemini API calls) — Phase I
- Real DID registry or resolver beyond `did:jwk` — Phase I
- VC revocation mechanism — Phase I
- Cross-platform endpoint monitoring (Linux/Windows) — Phase I
- Real Sigstore OIDC signing — Phase I
- Any network calls — Phase I

---

## Known Uncertainties to Resolve During Phase D

Ordered by likelihood of blocking `cargo check`:

1. `ssi` feature flag names — may be `"w3c-vc"`, `"ld-proofs"`, etc. rather than `"p256"`
2. `Credential::builder()` — may not exist at 0.14.0; check `ssi::claims::vc`
3. `NonEmptyVec` — may be from `ssi-core` sub-crate or not exported from top-level
4. `uri!()` macro — import path unknown; may be `ssi::prelude::*` or `iref::uri!`
5. `.sign(jwk)` — async method; receiver and param types need verification
6. `VerifiablePresentation` builder — pattern may differ from `Credential` builder
7. `endpoint_sec::Client::new()` — callback type signature in 0.4.3 unknown
8. `sigstore` 0.13.0 verification entry point — may have moved between minor versions

Each uncertainty that causes a `cargo check` error should be resolved by reading
the actual crate source (not docs.rs HTML) and correcting the stub signature.
The correction itself is Phase D work — it does not require re-running GOAP.

---

## How This Manifest Was Produced

- Crate versions: confirmed from live `fetch()` of docs.rs pages (2026-02-19)
- Interface shapes: derived from ADR pseudocode in `Bunker-Strategy-v1.md`
- Feature flags and exact API paths: inferred from training data — treat as
  **unverified starting points**, not ground truth
- Validation method: `cargo check` is the ground truth; this manifest is the
  first draft that `cargo check` will correct

---

*This manifest is the R→D handoff artifact. It is the reusable template pattern:
every future GOAP research run should produce an ADR + a manifest like this one
before any Phase D work begins.*
