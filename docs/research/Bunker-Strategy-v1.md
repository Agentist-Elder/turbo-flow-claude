# Bunker Strategy v1 — GTIG Feb 2026 Infrastructure Trust Gap

> Generated: 2026-02-20T00:15:57.215Z
> Model: gemini-2.5-flash via PAL
> AIDefence: PASSED | RVF Witnessed: pending
> Goal: Analyse the trust assumptions in RFC 3161 timestamping and compare them to Sigstore Rekor as a timestamp authority. For ...

---
# Research Note: RFC 3161 Timestamping vs. Sigstore Rekor

This research note analyzes the trust assumptions, cryptographic proofs, failure modes, and legal/auditor preferences for RFC 3161 timestamping and Sigstore Rekor as a timestamp authority.

## 1. RFC 3161 Timestamping

RFC 3161 defines a protocol for obtaining a cryptographically secured timestamp from a Time Stamping Authority (TSA) [^1]. This is a traditional Public Key Infrastructure (PKI)-based approach to trusted timestamping [^2].

### 1.1. Cryptographic Proof

RFC 3161 cryptographically proves that a specific data hash existed at or before a particular point in time [^1]. A client computes a hash (a "digital fingerprint") of the data and sends it to a TSA. The TSA then concatenates a trustworthy time value with this hash, computes a new hash of this concatenation, and digitally signs it with its private key. This signed structure, known as a Time-Stamp Token (TST), is returned to the client [^2]. The TST cryptographically binds the data's hash to a specific time, providing non-repudiation of existence and possession at that moment [^2]. The TSA never sees the original data, only its hash, preserving confidentiality [^2].

### 1.2. Trust Assumptions

The primary trust in RFC 3161 lies with the **Time Stamping Authority (TSA)**, which acts as a Trusted Third Party (TTP) [^1], [^2].
*   **TSA Integrity**: The client must trust the TSA to be honest and not maliciously or erroneously issue backdated or future-dated timestamps [^2].
*   **TSA's Time Source**: The TSA is required to use a trustworthy and accurate source of time [^1].
*   **TSA's Private Key Security**: The TSA's private signing key, generated exclusively for timestamping, must be kept secure and uncompromised [^1].
*   **TSA's Certificate Validity**: The client must verify that the TSA's public key certificate was valid and unrevoked at the time the timestamp was issued and at the time of verification [^1].
*   **Hash Function Robustness**: Assumes the collision resistance of the hash function used for the data imprint [^1].

### 1.3. Failure Modes

*   **Compromised TSA Private Key**: If an attacker gains unauthorized access to the TSA's private signing key, they could forge TSTs for any arbitrary past or future time, invalidating the proof of existence.
*   **Malicious TSA Operator**: A rogue TSA could intentionally issue incorrect timestamps (e.g., backdating or future-dating) or refuse service.
*   **Inaccurate Time Source**: If the TSA's internal clock or its source of time is compromised or drifts significantly, the timestamps will not reflect the true time.
*   **Revoked TSA Certificate**: If the TSA's certificate is revoked, new timestamps cannot be reliably issued or verified, and previously issued ones might be questioned if the revocation implies a compromise.
*   **Lack of Client Verification**: If the requesting entity fails to properly verify the TST (e.g., checking the hash, nonce, TSA certificate status, and policy), it may accept an invalid or compromised timestamp [^1].

### 1.4. Court or Auditor Preference

A court or auditor would typically prefer RFC 3161 timestamping in scenarios where:
*   **Legal Admissibility and Accountability**: A single, identifiable, and legally accountable Trusted Third Party (TSA) provides the attestation. This is crucial for legal documents, contracts, intellectual property claims, and regulatory compliance where the identity and operational policies of the TSA can be audited and held responsible [^2].
*   **Confidentiality of Data**: Only the hash of the data is sent to the TSA, ensuring the content itself remains private [^2].
*   **Proof of Existence at a Specific Moment**: The primary goal is to establish irrefutable proof that a specific digital artifact existed *at or before* a precise moment in time.
*   **Established PKI Framework**: When the legal and technical framework for Public Key Infrastructure (PKI) and Certificate Authorities (CAs) is well-understood and accepted.

## 2. Sigstore Rekor as a Timestamp Authority

Sigstore Rekor operates as a transparency log, providing an immutable, tamper-resistant ledger for software supply chain metadata [^3]. While not a traditional RFC 3161 TSA, it serves a similar function by providing verifiable proof of existence and integrity, but with a different trust model.

### 2.1. Cryptographic Proof

Rekor cryptographically proves that an entry (typically a signature over an artifact, the associated public key, and other metadata) has been recorded in its append-only, verifiable data structure (a Merkle tree-based transparency log) at or before a certain time [^3]. The "timestamp" is implicitly derived from the entry's position within the continuously growing, verifiable log. It provides:
*   **Inclusion Proof**: Verifies that a specific entry is part of the log.
*   **Consistency Proof**: Verifies that the log has only grown and no existing entries have been altered or removed [^3].
*   **Non-Repudiation of Logged Events**: Once an entry is in the log, its existence and the time it was added are publicly verifiable and cannot be denied by the log operator without detection by auditors [^3].

### 2.2. Trust Assumptions

Rekor shifts from a single Trusted Third Party model to a **distributed trust and transparency model** [^3].
*   **Transparency Log Integrity (Auditors)**: Trust is distributed among multiple independent auditors who continuously monitor the log for consistency. The system assumes that at least one honest auditor will detect any attempt by the log operator to tamper with or fork the log [^3].
*   **Log Operator (Rekor Instance) Honesty (Initial Entry)**: While auditors verify the log's consistency, the initial act of adding an entry still relies on the Rekor instance to correctly record the submitted data and assign a timestamp. However, any attempt to later alter or remove this entry would be detectable.
*   **Merkle Tree Security**: Relies on the cryptographic properties of the underlying Merkle tree (e.g., Trillian) to ensure tamper-evidence.
*   **PKI for Signatures**: Rekor logs signatures, which themselves depend on the integrity of the Certificate Authority (e.g., Sigstore's Fulcio) that issued the signing certificates.
*   **Active Auditing**: The security model fundamentally depends on the existence and activity of independent auditors to monitor the log for inconsistencies [^3].

### 2.3. Failure Modes

*   **Lack of Active Auditing**: If there are insufficient or inactive auditors, a malicious Rekor operator could potentially tamper with the log (e.g., by presenting different views to different users or deleting entries) without immediate detection.
*   **Censorship by Log Operator**: A malicious Rekor operator could refuse to log certain entries, preventing them from gaining the transparency benefits. However, this does not compromise the integrity of *already logged* entries.
*   **Compromised Signing Keys (upstream)**: If the private keys used to sign the artifacts (which are then logged in Rekor) are compromised, fraudulent signatures could be logged. Rekor itself logs the *fact* of a signature, not its inherent trustworthiness.
*   **Fundamental Cryptographic Break**: A break in the hash functions or Merkle tree construction could compromise the log's integrity, though this is a general cryptographic risk.
*   **Collusion of Operators and Auditors**: If a malicious Rekor operator successfully colludes with all active auditors, log tampering could go undetected.

### 2.4. Court or Auditor Preference

A court or auditor would typically prefer Sigstore Rekor in scenarios where:
*   **Public Verifiability and Distributed Trust**: The goal is to provide transparent, publicly auditable proof of existence and integrity for software artifacts across a supply chain [^3]. This is particularly valuable for open-source software, critical infrastructure, and scenarios where broad community trust is desired over reliance on a single TTP.
*   **Tamper-Evidence and Retrospective Auditing**: The system is designed to detect *any* attempt to alter or remove past entries, making it highly suitable for proving continuous integrity over time and detecting historical tampering [^3].
*   **Software Supply Chain Security**: For proving the provenance of software components, build artifacts, and their associated signatures, addressing threats like "Just-in-Time Code Generation" by requiring verifiable origins.
*   **Identity and Artifact Binding**: When it's important to publicly link the identity of a signer (e.g., a developer's OIDC identity via Fulcio) to a specific artifact and its signature.

## 3. Verdict

Both RFC 3161 timestamping and Sigstore Rekor provide mechanisms for establishing proof of existence at a certain time, but they differ fundamentally in their trust models and primary use cases.

**RFC 3161** relies on a **centralized Trusted Third Party (TSA)**. Its strength lies in the legal accountability and established PKI framework of the TSA, making it suitable for high-stakes legal and regulatory compliance where a single, auditable entity's attestation is paramount. Its primary vulnerability is the compromise or malice of this single trusted entity.

**Sigstore Rekor** employs a **distributed trust model via transparency logs and public auditing**. Its strength is in providing publicly verifiable, tamper-evident proof of inclusion in an immutable ledger, making it highly resilient against a single point of failure or a malicious log operator (provided active auditing exists). It excels in software supply chain security, offering transparency and retrospective tamper detection. Its vulnerability lies in the potential lack of active auditing or the ability of a malicious actor to censor entries.

For a court or auditor, the choice depends on the specific legal and technical context:
*   **RFC 3161** is generally preferred when the legal weight and established accountability of a commercial or governmental TSA are required, especially for confidential documents where only the hash is exposed.
*   **Sigstore Rekor** is preferred for public software supply chain integrity, where transparency, community auditing, and tamper-evidence against retrospective modification are critical. It provides a robust mechanism for proving the *history* and *integrity* of software artifacts.

In summary, RFC 3161 offers a "point-in-time" attestation from a singular trusted source, while Rekor provides a "proof-of-inclusion-in-an-immutable-history" from a transparent, community-audited ledger. Neither is inherently "better" than the other; their suitability is determined by the specific trust requirements, threat model, and legal/auditing context of the application.

---

## Appendix: Source References

| Ref | Source | SHA-256 (at research time) | Fetched |
|-----|--------|---------------------------|---------|
| [^1] | [https://www.rfc-editor.org/rfc/rfc3161.html](https://www.rfc-editor.org/rfc/rfc3161.html) | `2eb5d864cf3dcd65cca9ef131be2d1b1f171c08b9284fcf6a3301d2e47c5f15e` | 2026-02-20T00:15:24.327Z |
| [^2] | [https://en.wikipedia.org/wiki/Trusted_timestamping](https://en.wikipedia.org/wiki/Trusted_timestamping) | `6c6e9cc506a1a55ee9465505489ef84ffc08d80fa3b0b82b0ec330675838eb4e` | 2026-02-20T00:15:24.450Z |
| [^3] | [https://docs.sigstore.dev/logging/overview/](https://docs.sigstore.dev/logging/overview/) | `80f7fd71d86db4a356817ce4bd662a47fb15d53d303dede6fac3d6841c6b80f2` | 2026-02-20T00:15:24.859Z |