/**
 * RuvBot Swarm - Post-Quantum Wrapper (Phase 14+)
 *
 * Applies an ML-DSA-65 (FIPS 204) signature over a document's SHA-3 hash
 * binding, providing a quantum-resistant outer layer around the classical
 * RFC 3161 TSA token and Rekor/cosign bundle.
 *
 * What this protects:
 *   The binding between document content, TSA timestamp, and Rekor entry.
 *   A quantum adversary cannot forge the outer signature to claim a different
 *   document was attested.
 *
 * What this does NOT protect:
 *   The TSA's own credential chain (still classical RSA/ECDSA). Full PQ
 *   protection requires PQ-capable TSAs (ETSI TS 119 312 migration, in
 *   progress at DigiCert and others). This is defence-in-depth.
 *
 * Trust anchor:
 *   The public key is self-signed. For external auditability, register it
 *   in a DID Document (Phase 13 DID Passport hook — see NOTE_DID below)
 *   or push it to Rekor as a transparency-log entry.
 *
 * Key storage:
 *   Seed (32 bytes, hex) → ~/.ruvbot-pq.seed  (gitignored, keep safe)
 *   The full keypair is derived deterministically from the seed on each run.
 *
 * Usage:
 *   npx tsx src/pq-wrap.ts --keygen               # generate and save seed
 *   npx tsx src/pq-wrap.ts <file.md>              # wrap document
 *   npx tsx src/pq-wrap.ts --verify <file.md>     # verify wrapper
 *
 * Algorithm choices:
 *   ML-DSA-65  — NIST FIPS 204, Level 3, 128-bit quantum security
 *   SHA3-256   — NIST SHA-3 (Grover speedup is √, not polynomial; 256-bit
 *                SHA-3 gives ~128-bit quantum preimage resistance)
 */
interface Keypair {
    secretKey: Uint8Array;
    publicKey: Uint8Array;
    seedHex: string;
}
export interface WrapManifest {
    algorithm: string;
    bundle_sha3_256: string;
    document_sha3_256: string;
    tsa_sha3_256: string;
    wrapped_at: string;
}
export interface PQWrapOutput {
    algorithm: string;
    public_key: string;
    manifest: WrapManifest;
    manifest_canonical: string;
    signature: string;
    note: string;
}
/**
 * Wrap a document with a post-quantum signature.
 *
 * @param docPath   Path to the .md research document
 * @param keypair   Keypair from loadKeypair() or generateKeypair()
 * @returns         The .pq.json payload (also written to <docPath>.pq.json)
 */
export declare function wrapDocument(docPath: string, keypair: Keypair): Promise<PQWrapOutput>;
export interface VerifyResult {
    valid: boolean;
    reason?: string;
    manifest?: WrapManifest;
    currentHashes?: {
        document: string;
        tsa: string;
        bundle: string;
    };
}
/**
 * Verify an existing .pq.json wrapper against the current state of the document.
 */
export declare function verifyWrapper(docPath: string): Promise<VerifyResult>;
export {};
