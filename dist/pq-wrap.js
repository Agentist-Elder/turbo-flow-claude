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
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { randomBytes } from 'crypto';
import { readFile, writeFile, access } from 'fs/promises';
import { homedir } from 'os';
import { resolve, basename } from 'path';
// ─── constants ────────────────────────────────────────────────────────────────
const ALGORITHM = 'ML-DSA-65 (FIPS 204)';
const DEFAULT_SEED_FILE = `${homedir()}/.ruvbot-pq.seed`;
// NOTE_DID: When Phase 13 DID Passport is built, call registerPublicKeyInDID()
// here with the hex public key. The DID Document then becomes the trust anchor.
// ─── helpers ──────────────────────────────────────────────────────────────────
function toHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}
function fromHex(hex) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}
async function fileExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function hashFile(filePath) {
    const bytes = await readFile(filePath);
    return toHex(sha3_256(bytes));
}
/**
 * Canonical JSON: sorted keys, no trailing whitespace.
 * Ensures the manifest bytes are identical regardless of object construction order.
 */
function canonicalJson(obj) {
    const sorted = {};
    for (const k of Object.keys(obj).sort())
        sorted[k] = obj[k];
    return JSON.stringify(sorted);
}
async function generateKeypair() {
    const seed = randomBytes(32);
    const { secretKey, publicKey } = ml_dsa65.keygen(seed);
    return { secretKey, publicKey, seedHex: toHex(seed) };
}
async function loadKeypair(seedFile = DEFAULT_SEED_FILE) {
    const seedHex = (await readFile(seedFile, 'utf8')).trim();
    if (seedHex.length !== 64)
        throw new Error(`Invalid seed in ${seedFile}: expected 64 hex chars`);
    const seed = fromHex(seedHex);
    const { secretKey, publicKey } = ml_dsa65.keygen(seed);
    return { secretKey, publicKey, seedHex };
}
async function saveSeed(seedHex, seedFile = DEFAULT_SEED_FILE) {
    await writeFile(seedFile, seedHex + '\n', { mode: 0o600 });
}
/**
 * Wrap a document with a post-quantum signature.
 *
 * @param docPath   Path to the .md research document
 * @param keypair   Keypair from loadKeypair() or generateKeypair()
 * @returns         The .pq.json payload (also written to <docPath>.pq.json)
 */
export async function wrapDocument(docPath, keypair) {
    // TSA is named <basename-without-ext>.tsa.json (no .md in the middle)
    // Bundle is named <docpath>.bundle (keeps .md)
    const tsaPath = docPath.replace(/\.[^.]+$/, '') + '.tsa.json';
    const bundlePath = `${docPath}.bundle`;
    const docHash = await hashFile(docPath);
    const tsaHash = (await fileExists(tsaPath)) ? await hashFile(tsaPath) : 'none';
    const bundleHash = (await fileExists(bundlePath)) ? await hashFile(bundlePath) : 'none';
    const manifest = {
        algorithm: ALGORITHM,
        bundle_sha3_256: bundleHash,
        document_sha3_256: docHash,
        tsa_sha3_256: tsaHash,
        wrapped_at: new Date().toISOString(),
    };
    // Sign the canonical JSON bytes — deterministic across runtimes
    // WrapManifest is all-string fields; cast is safe.
    const manifestCanonical = canonicalJson(manifest);
    const msgBytes = new TextEncoder().encode(manifestCanonical);
    const sigBytes = ml_dsa65.sign(msgBytes, keypair.secretKey);
    const output = {
        algorithm: ALGORITHM,
        public_key: toHex(keypair.publicKey),
        manifest,
        manifest_canonical: manifestCanonical,
        signature: toHex(sigBytes),
        note: [
            'Self-signed PQ wrapper (ML-DSA-65, FIPS 204).',
            'Quantum-resistant binding over document + TSA token + Rekor bundle hashes.',
            'The classical TSA credential chain (.tsa.json) is still RSA/ECDSA.',
            'Phase 13 hook: register public_key in DID Document for external trust anchor.',
        ].join(' '),
    };
    const outPath = `${docPath}.pq.json`;
    await writeFile(outPath, JSON.stringify(output, null, 2) + '\n');
    return output;
}
/**
 * Verify an existing .pq.json wrapper against the current state of the document.
 */
export async function verifyWrapper(docPath) {
    const pqPath = `${docPath}.pq.json`;
    if (!(await fileExists(pqPath))) {
        return { valid: false, reason: `No .pq.json found at ${pqPath}` };
    }
    let output;
    try {
        output = JSON.parse(await readFile(pqPath, 'utf8'));
    }
    catch (e) {
        return { valid: false, reason: `Cannot parse .pq.json: ${e.message}` };
    }
    // 1. Re-hash current files
    const tsaPath = docPath.replace(/\.[^.]+$/, '') + '.tsa.json';
    const bundlePath = `${docPath}.bundle`;
    const currentDoc = await hashFile(docPath);
    const currentTsa = (await fileExists(tsaPath)) ? await hashFile(tsaPath) : 'none';
    const currentBundle = (await fileExists(bundlePath)) ? await hashFile(bundlePath) : 'none';
    // 2. Check hashes match the recorded manifest
    const { manifest } = output;
    if (currentDoc !== manifest.document_sha3_256) {
        return {
            valid: false,
            reason: `Document has changed since wrapping. Expected ${manifest.document_sha3_256.slice(0, 16)}… got ${currentDoc.slice(0, 16)}…`,
            manifest,
            currentHashes: { document: currentDoc, tsa: currentTsa, bundle: currentBundle },
        };
    }
    if (currentTsa !== manifest.tsa_sha3_256) {
        return {
            valid: false,
            reason: `TSA token has changed since wrapping.`,
            manifest,
            currentHashes: { document: currentDoc, tsa: currentTsa, bundle: currentBundle },
        };
    }
    if (currentBundle !== manifest.bundle_sha3_256) {
        return {
            valid: false,
            reason: `Rekor bundle has changed since wrapping. (Expected — if publish.ts was run after pq-wrap, re-wrap the document.)`,
            manifest,
            currentHashes: { document: currentDoc, tsa: currentTsa, bundle: currentBundle },
        };
    }
    // 3. Verify ML-DSA-65 signature
    const msgBytes = new TextEncoder().encode(output.manifest_canonical);
    const sigBytes = fromHex(output.signature);
    const pubBytes = fromHex(output.public_key);
    let sigValid;
    try {
        sigValid = ml_dsa65.verify(sigBytes, msgBytes, pubBytes);
    }
    catch (e) {
        return { valid: false, reason: `Signature verification threw: ${e.message}` };
    }
    if (!sigValid) {
        return { valid: false, reason: 'ML-DSA-65 signature is invalid.', manifest };
    }
    return { valid: true, manifest };
}
// ─── CLI ──────────────────────────────────────────────────────────────────────
async function cli() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help')) {
        console.log([
            'Usage:',
            '  npx tsx src/pq-wrap.ts --keygen              Generate and save ML-DSA-65 seed',
            '  npx tsx src/pq-wrap.ts <file.md>             Wrap document with PQ signature',
            '  npx tsx src/pq-wrap.ts --verify <file.md>    Verify an existing .pq.json',
            '',
            `Seed file: ${DEFAULT_SEED_FILE}`,
        ].join('\n'));
        return;
    }
    // ── keygen ──────────────────────────────────────────────────────────────────
    if (args[0] === '--keygen') {
        if (await fileExists(DEFAULT_SEED_FILE)) {
            console.error(`Seed file already exists: ${DEFAULT_SEED_FILE}`);
            console.error('Delete it manually if you want to generate a new keypair.');
            process.exit(1);
        }
        const kp = await generateKeypair();
        await saveSeed(kp.seedHex);
        console.log(`\nML-DSA-65 keypair generated.`);
        console.log(`Seed (32 bytes): ${DEFAULT_SEED_FILE}  [mode 0600 — keep safe]`);
        console.log(`Public key (hex, first 32 chars): ${kp.seedHex.slice(0, 32)}…`);
        console.log(`\nPublic key length : ${kp.publicKey.length} bytes`);
        console.log(`Secret key length : ${kp.secretKey.length} bytes`);
        console.log(`Signature length  : 3309 bytes (fixed for ML-DSA-65)`);
        return;
    }
    // ── verify ──────────────────────────────────────────────────────────────────
    if (args[0] === '--verify') {
        const docPath = resolve(args[1] ?? '');
        if (!(await fileExists(docPath))) {
            console.error(`File not found: ${docPath}`);
            process.exit(1);
        }
        console.log(`\nPQ-Wrap verify: ${basename(docPath)}`);
        const result = await verifyWrapper(docPath);
        if (result.valid) {
            console.log(`\n✓  ML-DSA-65 signature VALID`);
            console.log(`   Wrapped at : ${result.manifest?.wrapped_at}`);
            console.log(`   Document   : ${result.manifest?.document_sha3_256.slice(0, 32)}…`);
            console.log(`   TSA token  : ${result.manifest?.tsa_sha3_256.slice(0, 32)}…`);
            console.log(`   Bundle     : ${result.manifest?.bundle_sha3_256.slice(0, 32)}…`);
        }
        else {
            console.error(`\n✗  Verification FAILED`);
            console.error(`   Reason: ${result.reason}`);
            process.exit(1);
        }
        return;
    }
    // ── wrap ────────────────────────────────────────────────────────────────────
    const docPath = resolve(args[0]);
    if (!(await fileExists(docPath))) {
        console.error(`File not found: ${docPath}`);
        process.exit(1);
    }
    let keypair;
    if (await fileExists(DEFAULT_SEED_FILE)) {
        keypair = await loadKeypair();
        console.log(`\nLoaded keypair from ${DEFAULT_SEED_FILE}`);
    }
    else {
        console.log(`\nNo seed file found — generating new keypair at ${DEFAULT_SEED_FILE}`);
        keypair = await generateKeypair();
        await saveSeed(keypair.seedHex);
    }
    console.log(`Wrapping: ${basename(docPath)}`);
    const output = await wrapDocument(docPath, keypair);
    console.log(`\n✓  PQ wrapper written: ${basename(docPath)}.pq.json`);
    console.log(`   Algorithm  : ${output.algorithm}`);
    console.log(`   Wrapped at : ${output.manifest.wrapped_at}`);
    console.log(`   Document   : ${output.manifest.document_sha3_256.slice(0, 32)}…`);
    console.log(`   TSA token  : ${output.manifest.tsa_sha3_256.slice(0, 32)}…`);
    console.log(`   Bundle     : ${output.manifest.bundle_sha3_256.slice(0, 32)}…`);
    console.log(`   Public key : ${output.public_key.slice(0, 32)}… (${keypair.publicKey.length} bytes)`);
    console.log(`   Signature  : ${output.signature.slice(0, 32)}… (${keypair.secretKey.length / 2} bytes stored as hex)`);
    console.log(`\nPhase 13 hook: register public_key in your DID Document for external trust.`);
}
cli().catch((e) => {
    console.error(e);
    process.exit(1);
});
