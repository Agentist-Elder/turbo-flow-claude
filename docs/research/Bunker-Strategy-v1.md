# Bunker Strategy v1 — GTIG Feb 2026 Infrastructure Trust Gap

> Generated: 2026-02-20T04:03:20.097Z
> Model: gemini-2.5-flash via PAL
> AIDefence: GATED (security-research override) | RVF Witnessed: pending
> Goal: Analyse the trust assumptions in RFC 3161 timestamping and compare them to Sigstore Rekor as a timestamp authority. For ...

> **SIGNED RESEARCH WARNING**: This content was gated by AIDefence L3
> but allowed under `--allow-security-research` for defensive threat analysis.
> The override is recorded in the RVF witness chain for audit purposes.

---
This analysis compares RFC 3161 timestamping with Sigstore Rekor as a timestamp authority, focusing on their cryptographic proof, trust models, failure modes, and suitability for legal and auditing contexts.

## RFC 3161 Timestamping

RFC 3161 defines a Time-Stamp Protocol (TSP) for establishing proof that a datum existed before a particular time [^1]. It relies on a centralized Time Stamping Authority (TSA) to issue cryptographically protected timestamps.

### Cryptographic Proof

The cryptographic proof in RFC 3161 is a digitally signed timestamp token (TST) [^1, p. 3].
1.  The client computes a cryptographic hash (data imprint) of the data it wishes to timestamp.
2.  This hash is sent to the TSA.
3.  The TSA concatenates a trustworthy time value with the received hash and computes a hash of this concatenation [^2, p. 317].
4.  The TSA then digitally signs this new hash using its private key, which is reserved exclusively for timestamping purposes [^1, p. 2, 3].
5.  The resulting signed hash, along with the timestamp and other metadata (like a nonce for replay protection), forms the TST, which is returned to the client.
6.  Verification involves recalculating the hash of the original data and the timestamp, then using the TSA's public key (from its X.509 certificate) to decrypt the TST's signature and compare the hashes [^2, p. 331-333]. The TSA's certificate must contain the `id-kp-timeStamping` extended key usage [^1, p. 3].

### Trust Model

The trust model for RFC 3161 is **centralized and hierarchical**, based on the Public Key Infrastructure (PKI) model [^2, p. 237].
*   **Trusted Third Party (TTP)**: Users explicitly trust the TSA to be honest, secure, and to operate its time source accurately [^1, p. 2]. The TSA is expected to follow a defined security policy, which clients should verify [^1, p. 2, 3].
*   **PKI Chain of Trust**: Trust in the TSA's public key is established through its X.509 certificate, which is typically issued by a well-known Certificate Authority (CA). Users trust the CA hierarchy to validate the TSA's identity and operational integrity.
*   **Auditable Policies**: While the protocol doesn't define overall security requirements for TSA operation, it anticipates that TSAs will make their policies known to clients, who then decide if these policies meet their needs [^1, p. 2].

### Failure Modes

*   **Compromised TSA Private Key**: If the TSA's private signing key is compromised, an attacker could issue backdated or future-dated timestamps, undermining the integrity of the entire system. This is a critical single point of failure.
*   **Untrustworthy Time Source**: If the TSA's internal time source is manipulated or inaccurate, all issued timestamps will be incorrect, leading to false assertions of existence.
*   **TSA Operational Failure/Malfeasance**: A malicious or mismanaged TSA could refuse to issue timestamps, selectively issue them, or collude to deny the existence of data at a certain time.
*   **Certificate Revocation Issues**: If the TSA's certificate is revoked, previously issued timestamps may become difficult to verify, or new ones cannot be issued. Clients must check the certificate's validity (e.g., via CRLs) [^1, p. 3].
*   **Replay Attacks**: Without proper nonce usage, an attacker could replay a timestamp request, though the protocol includes mechanisms to mitigate this [^1, p. 3].

### Court or Auditor Preference

A court or auditor would prefer RFC 3161 timestamping in scenarios requiring:
*   **Established Legal Precedent**: RFC 3161 is a widely adopted standard with mature legal frameworks and established practices for digital signatures and PKI, making it readily accepted as evidence in many jurisdictions.
*   **Clear Accountability**: The centralized nature provides a clear entity (the TSA) responsible for the timestamp's accuracy and integrity, which simplifies legal accountability.
*   **Regulatory Compliance**: Many industry-specific regulations and compliance standards (e.g., for financial transactions, medical records) explicitly recognize and often mandate PKI-based digital signatures and timestamping.
*   **Confidentiality**: Since only the hash of the data is sent to the TSA, the original data remains confidential, which is crucial for sensitive documents [^2, p. 319].

## Sigstore Rekor as a Timestamp Authority

Sigstore Rekor is a transparency log designed to provide an immutable, tamper-resistant ledger of metadata generated within a software supply chain [^3, p. 369]. While not a traditional RFC 3161 TSA, Rekor serves a similar function by providing verifiable proof of existence and integrity for software artifacts at a given time.

### Cryptographic Proof

Rekor's cryptographic proof relies on a **verifiable data structure**, specifically a Merkle tree (or similar append-only log structure like Trillian) [^3, p. 373].
1.  When an entry (e.g., a signed software artifact, its hash, and associated metadata) is submitted to Rekor, it is added to the log.
2.  Each entry is cryptographically linked to the previous entries, forming a chain.
3.  The log periodically publishes a **Merkle tree root hash** (also known as a Signed Tree Head or STH). This root hash cryptographically commits to the entire state of the log at that moment.
4.  **Inclusion Proofs**: A client can request an inclusion proof (Merkle proof) for any entry. This proof demonstrates that a specific entry is indeed part of the log and contributes to a given root hash.
5.  **Consistency Proofs**: Auditors and clients can request consistency proofs between two root hashes. This proves that a later root hash correctly extends an earlier one, meaning no entries have been retroactively removed or altered in the log [^3, p. 373].
6.  The combination of inclusion and consistency proofs, along with the log's public auditability, provides strong cryptographic evidence of an artifact's existence and the integrity of the log itself.

### Trust Model

Rekor employs a **distributed trust model** based on transparency and public verifiability, rather than relying solely on a single trusted third party [^3, p. 373].
*   **Transparency Log**: The core principle is that all entries are publicly visible and auditable. This "trust but verify" approach allows anyone to monitor the log for consistency and ensure it remains append-only.
*   **Auditors**: Multiple independent auditors (e.g., Rekor monitor, omniwitness) can continuously monitor the log, checking for consistency and detecting any attempts at tampering [^3, p. 375-377]. If a log operator attempts to alter history, it would be detected by these auditors, leading to a public outcry and loss of trust.
*   **Community Trust**: Trust is distributed across the log operator, the community of auditors, and the cryptographic properties of the Merkle tree. The log operator is trusted to append entries correctly, but its ability to tamper is severely constrained by public scrutiny.
*   **Ephemeral Certificates**: In the broader Sigstore ecosystem, Rekor works with Fulcio (a certificate authority) which issues short-lived certificates, reducing the impact of key compromise compared to long-lived PKI keys.

### Failure Modes

*   **Log Operator Collusion (Detectable)**: While the log operator could theoretically attempt to present different views of the log to different parties (a "fork"), this would be detected by independent auditors performing consistency checks. The log's design makes *undetected* tampering extremely difficult.
*   **Log Unavailability**: If the Rekor service is unavailable, new entries cannot be logged, and existing proofs cannot be immediately verified. However, previously obtained proofs remain valid.
*   **Misconfiguration/Bugs**: Software bugs or misconfigurations in the Rekor implementation could lead to incorrect logging or proof generation, though the open-source nature and auditing mechanisms help in detection.
*   **Auditor Apathy**: The effectiveness of the distributed trust model relies on active participation from independent auditors. If no one audits the log, the benefits of transparency are diminished.

### Court or Auditor Preference

A court or auditor would prefer Sigstore Rekor in scenarios focused on:
*   **Software Supply Chain Integrity**: Rekor is specifically designed for securing software artifacts, providing an auditable record of builds, releases, and dependencies. This is critical for modern software development and combating supply chain attacks.
*   **Public Verifiability and Tamper-Evidence**: The transparency log model allows any interested party to verify the integrity of the log and the inclusion of specific entries. This is powerful for demonstrating non-repudiation in a public, community-driven context.
*   **Detecting Retroactive Tampering**: The consistency proofs make it extremely difficult for a malicious actor (even the log operator) to retroactively alter or remove entries without being detected, offering a stronger guarantee against historical revision than a single-point-of-failure TSA.
*   **Open-Source and Community Projects**: For open-source software, where trust is often distributed and transparency is valued, Rekor provides a robust, auditable mechanism for proving artifact provenance.
*   **Modern Digital Forensics**: For digital artifacts where the "when" is critical and public auditability is desired, Rekor offers a compelling, cryptographically strong, and transparent record.

## Conclusion

Both RFC 3161 timestamping and Sigstore Rekor provide mechanisms for establishing proof of existence at a specific time, but they differ fundamentally in their trust models and application domains. RFC 3161 relies on a centralized, PKI-based trust in a single TSA, making it suitable for established legal and regulatory contexts where clear accountability is paramount. Rekor, conversely, leverages a distributed trust model through a publicly auditable transparency log, excelling in scenarios requiring verifiable, tamper-evident records for software supply chain integrity and open-source ecosystems. The choice between them depends on the specific legal, regulatory, and technical requirements, as well as the desired balance between centralized accountability and distributed, transparent verifiability.

## Appendix: Source References

| Ref | Source | SHA-256 (at research time) | Fetched |
|-----|--------|---------------------------|---------|
| [^1] | [https://www.rfc-editor.org/rfc/rfc3161.html](https://www.rfc-editor.org/rfc/rfc3161.html) | `2eb5d864cf3dcd65cca9ef131be2d1b1f171c08b9284fcf6a3301d2e47c5f15e` | 2026-02-20T04:03:00.954Z |
| [^2] | [https://en.wikipedia.org/wiki/Trusted_timestamping](https://en.wikipedia.org/wiki/Trusted_timestamping) | `6c6e9cc506a1a55ee9465505489ef84ffc08d80fa3b0b82b0ec330675838eb4e` | 2026-02-20T04:03:01.061Z |
| [^3] | [https://docs.sigstore.dev/logging/overview/](https://docs.sigstore.dev/logging/overview/) | `80f7fd71d86db4a356817ce4bd662a47fb15d53d303dede6fac3d6841c6b80f2` | 2026-02-20T04:03:01.405Z |

---

## Provenance & Verification

| Field | Value |
|-------|-------|
| **Signed** | 2026-02-20T21:09:11.000Z |
| **Signer** | GitHub OIDC (keyless, Sigstore) |
| **Bundle** | `Bunker-Strategy-v1.md.bundle` |
| **Rekor log index** | 974858064 |
| **Verify** | `cosign verify-blob Bunker-Strategy-v1.md --bundle Bunker-Strategy-v1.md.bundle` |

[View on Rekor transparency log](https://search.sigstore.dev/?logIndex=974858064)

> This document was signed with [Sigstore/cosign](https://sigstore.dev) keyless signing.
> The signature is publicly verifiable without any private keys.
