/**
 * RuvBot Swarm - Publish & Sign (Phase 14)
 *
 * Seals a research document with a Sigstore/cosign keyless signature.
 * Appends a verifiable provenance block to the bottom of the .md file.
 *
 * Usage:
 *   npx tsx src/publish.ts <path-to-file.md>
 *
 * Prerequisites (one-time, in Codespace terminal):
 *   gh release download -R sigstore/cosign --pattern 'cosign-linux-amd64' \
 *     --output /usr/local/bin/cosign && chmod +x /usr/local/bin/cosign
 *
 * Flow:
 *   1. Verify cosign is installed
 *   2. cosign sign-blob <file> --bundle <file>.bundle --yes
 *      (opens a browser URL once for GitHub OIDC — paste it, click, done)
 *   3. Parse Rekor log index from the bundle JSON
 *   4. Append verification block to the .md file
 *   5. Print the public Rekor URL
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, appendFile, access } from 'fs/promises';
import { resolve, basename } from 'path';
const execFileAsync = promisify(execFile);
// ─── helpers ──────────────────────────────────────────────────────────────────
async function fileExists(p) {
    try {
        await access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function checkCosign() {
    const candidates = [
        `${process.env.HOME}/.local/bin/cosign`,
        '/usr/local/bin/cosign',
        '/usr/bin/cosign',
    ];
    for (const p of candidates) {
        if (await fileExists(p))
            return p;
    }
    // Fall back to PATH
    try {
        await execFileAsync('which', ['cosign']);
        return 'cosign';
    }
    catch {
        throw new Error(`cosign not found. Install it first:\n\n` +
            `  mkdir -p ~/.local/bin && gh release download -R sigstore/cosign \\\n` +
            `    --pattern 'cosign-linux-amd64' --output ~/.local/bin/cosign \\\n` +
            `    && chmod +x ~/.local/bin/cosign\n\n` +
            `Then re-run this script.`);
    }
}
function parseLogIndex(bundleJson) {
    try {
        const bundle = JSON.parse(bundleJson);
        // cosign v0.3+ bundle: tlogEntries is under verificationMaterial
        // cosign v0.2 bundle: tlogEntries is at the root
        const vm = bundle['verificationMaterial'];
        const entries = (vm?.['tlogEntries'] ?? bundle['tlogEntries']);
        if (Array.isArray(entries) && entries.length > 0) {
            const entry = entries[0];
            const li = entry['logIndex'];
            const it = entry['integratedTime'];
            if (li != null) {
                return {
                    logIndex: Number(li),
                    integratedTime: it != null ? String(it) : null,
                };
            }
        }
        // cosign v1 bundle format (.rekorBundle.Payload.logIndex)
        const rb = bundle['rekorBundle'];
        const payload = rb?.['Payload'];
        if (payload?.['logIndex'] != null) {
            return { logIndex: Number(payload['logIndex']), integratedTime: null };
        }
    }
    catch (e) {
        // fall through
    }
    // Last-resort regex scan of raw JSON
    const m = bundleJson.match(/"logIndex"\s*:\s*"?(\d+)"?/);
    if (m)
        return { logIndex: Number(m[1]), integratedTime: null };
    return { logIndex: null, integratedTime: null };
}
function rekorUrl(logIndex) {
    return `https://search.sigstore.dev/?logIndex=${logIndex}`;
}
function isoNow() {
    return new Date().toISOString();
}
// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help') {
        console.error('Usage: npx tsx src/publish.ts <path-to-file.md>');
        process.exit(1);
    }
    const filePath = resolve(args[0]);
    const bundlePath = `${filePath}.bundle`;
    if (!(await fileExists(filePath))) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }
    console.log(`\nRuvBot Publish — Phase 14`);
    console.log(`File : ${filePath}`);
    console.log(`Bundle: ${bundlePath}\n`);
    // ── 1. Check cosign ──────────────────────────────────────────────────────────
    let cosign;
    try {
        cosign = await checkCosign();
        console.log(`cosign : ${cosign} ✓`);
    }
    catch (e) {
        console.error(e.message);
        process.exit(1);
    }
    // ── 2. Sign ──────────────────────────────────────────────────────────────────
    console.log('\nSigning (cosign will open a browser URL for GitHub OIDC)...\n');
    let signStdout = '';
    let signStderr = '';
    try {
        // We use spawn-style so OIDC URL prints to the terminal in real time.
        // execFileAsync captures stdout/stderr but cosign prints the OIDC URL to
        // stderr, which the user needs to see. We inherit stdio instead.
        const { spawnSync } = await import('child_process');
        const result = spawnSync(cosign, [
            'sign-blob', filePath,
            '--bundle', bundlePath,
            '--yes',
        ], { stdio: 'inherit' });
        if (result.status !== 0) {
            throw new Error(`cosign exited with code ${result.status}`);
        }
    }
    catch (e) {
        console.error(`\nSigning failed: ${e.message}`);
        process.exit(1);
    }
    // ── 3. Parse bundle ──────────────────────────────────────────────────────────
    if (!(await fileExists(bundlePath))) {
        console.error(`Bundle file not created at: ${bundlePath}`);
        process.exit(1);
    }
    const bundleJson = await readFile(bundlePath, 'utf8');
    const { logIndex, integratedTime } = parseLogIndex(bundleJson);
    let rekorLink = 'https://search.sigstore.dev/ (check bundle file for log index)';
    if (logIndex != null) {
        rekorLink = rekorUrl(logIndex);
        console.log(`\nRekor log index : ${logIndex}`);
    }
    else {
        console.warn('\nWarning: could not parse log index from bundle. Bundle file saved.');
    }
    const verificationUrl = logIndex != null ? rekorLink : 'see .bundle file';
    const timestamp = integratedTime
        ? new Date(Number(integratedTime) * 1000).toISOString()
        : isoNow();
    // ── 4. Append verification block ─────────────────────────────────────────────
    const existingContent = await readFile(filePath, 'utf8');
    // Don't double-append
    if (existingContent.includes('## Provenance & Verification')) {
        console.log('\nVerification block already present — skipping append.');
        console.log(`Rekor URL: ${verificationUrl}`);
        process.exit(0);
    }
    const verificationBlock = `

---

## Provenance & Verification

| Field | Value |
|-------|-------|
| **Signed** | ${timestamp} |
| **Signer** | GitHub OIDC (keyless, Sigstore) |
| **Bundle** | \`${basename(bundlePath)}\` |
| **Rekor log index** | ${logIndex ?? 'see bundle'} |
| **Verify** | \`cosign verify-blob ${basename(filePath)} --bundle ${basename(bundlePath)}\` |

[View on Rekor transparency log](${verificationUrl})

> This document was signed with [Sigstore/cosign](https://sigstore.dev) keyless signing.
> The signature is publicly verifiable without any private keys.
`;
    await appendFile(filePath, verificationBlock, 'utf8');
    console.log(`\nVerification block appended to: ${filePath}`);
    // ── 5. Print Rekor URL ───────────────────────────────────────────────────────
    console.log(`\nRekor URL: ${verificationUrl}`);
    console.log('\nDone. The document is sealed.');
}
main().catch((e) => {
    console.error(e);
    process.exit(1);
});
