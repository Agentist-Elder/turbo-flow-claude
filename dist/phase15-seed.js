/**
 * Phase 15 — Synthetic Pattern Seeder
 *
 * Seeds 630 synthetic attack-pattern vectors into the VectorDB
 * (90 patterns × 7 GOAP phases) using the fixed VectorDB constructor.
 *
 * @ruvector/agentic-synth is not installed, so embeddings are generated
 * deterministically via SHA-256 hashing. Each phase gets a centroid vector;
 * individual patterns are tight perturbations of that centroid (α=0.9),
 * producing realistic cluster density for the λ proxy.
 *
 * Target DB: .claude-flow/data/ruvbot-coherence.db
 *   n=630 → polylogThreshold = (log₂630)² ≈ 86
 *   With α=0.9 cluster tightness, expected λ ≫ 86 → MinCut_Gate activates.
 *
 * Run:
 *   npx tsx src/phase15-seed.ts
 *   npx tsx src/phase15-seed.ts --dry-run   (prints counts, no DB write)
 */
import { createHash } from 'crypto';
import { mkdirSync } from 'fs';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const { VectorDB } = _require('ruvector');
// ── Constants ─────────────────────────────────────────────────────────────────
const DB_PATH = '.claude-flow/data/ruvbot-coherence.db';
const DIMENSIONS = 384;
const PATTERNS_PER_PHASE = 90;
/**
 * 7 GOAP phases. Each maps to a distinct cluster in embedding space.
 * Covers the full observe→orient→decide→act→review→learn loop plus
 * an adversarial "exploit" cluster for known attack morphologies.
 */
const GOAP_PHASES = [
    'goap_observe', // passive environment observation; state-read probes
    'goap_orient', // threat classification; goal alignment checks
    'goap_decide', // action selection; policy reasoning patterns
    'goap_act', // command execution; tool invocation patterns
    'goap_review', // outcome verification; reflection patterns
    'goap_learn', // model update triggers; reinforcement signals
    'goap_exploit', // adversarial: jailbreaks, prompt injections, role hijacks
];
// ── Embedding Generation ───────────────────────────────────────────────────────
/**
 * Derive a deterministic, reproducible 384-dim unit vector from a seed string.
 * Expands SHA-256 output by iterating with a counter until all dimensions fill.
 * Maps bytes [0, 255] → [-1, +1] before L2 normalisation.
 */
function hashVector(seed) {
    const buf = [];
    let counter = 0;
    while (buf.length < DIMENSIONS) {
        const h = createHash('sha256').update(`${seed}\x00${counter++}`).digest();
        for (const byte of h) {
            if (buf.length >= DIMENSIONS)
                break;
            buf.push((byte / 127.5) - 1.0);
        }
    }
    const arr = new Float32Array(buf);
    const mag = Math.sqrt(arr.reduce((s, x) => s + x * x, 0));
    for (let i = 0; i < arr.length; i++)
        arr[i] /= mag;
    return arr;
}
/**
 * Blend centroid with per-pattern perturbation, then re-normalise.
 * alpha=0.9 keeps patterns tightly clustered → high λ proxy density.
 */
function perturbedVector(centroid, seed, alpha = 0.9) {
    const noise = hashVector(seed);
    const blended = new Float32Array(DIMENSIONS);
    for (let i = 0; i < DIMENSIONS; i++) {
        blended[i] = alpha * centroid[i] + (1 - alpha) * noise[i];
    }
    const mag = Math.sqrt(blended.reduce((s, x) => s + x * x, 0));
    for (let i = 0; i < blended.length; i++)
        blended[i] /= mag;
    return blended;
}
function generatePhasePatterns(phase) {
    const centroid = hashVector(`centroid:${phase}`);
    const entries = [];
    for (let i = 0; i < PATTERNS_PER_PHASE; i++) {
        entries.push({
            id: `${phase}:${i.toString().padStart(3, '0')}`,
            vector: perturbedVector(centroid, `${phase}:pat:${i}`),
        });
    }
    return entries;
}
async function seed(dryRun) {
    const totalPatterns = GOAP_PHASES.length * PATTERNS_PER_PHASE;
    console.log(`[phase15-seed] Generating ${totalPatterns} patterns ` +
        `(${PATTERNS_PER_PHASE}/phase × ${GOAP_PHASES.length} phases)`);
    if (dryRun) {
        console.log('[phase15-seed] DRY RUN — no DB writes');
        for (const phase of GOAP_PHASES) {
            const entries = generatePhasePatterns(phase);
            console.log(`  ${phase}: ${entries.length} patterns (centroid[0]=${entries[0].vector[0].toFixed(6)})`);
        }
        console.log(`[phase15-seed] DRY RUN complete. Would seed ${totalPatterns} patterns.`);
        return;
    }
    mkdirSync('.claude-flow/data', { recursive: true });
    const db = new VectorDB({
        storagePath: DB_PATH,
        distanceMetric: 'Cosine',
        dimensions: DIMENSIONS,
        hnswConfig: {
            m: 32,
            efConstruction: 200,
            efSearch: 100,
            maxElements: 1_000_000,
        },
    });
    let total = 0;
    for (const phase of GOAP_PHASES) {
        const entries = generatePhasePatterns(phase);
        await db.insertBatch(entries);
        total += entries.length;
        const dbSize = await db.len();
        console.log(`[phase15-seed] ${phase}: +${entries.length} patterns (db.len=${dbSize})`);
    }
    const finalSize = await db.len();
    console.log(`\n[phase15-seed] Seeding complete.`);
    console.log(`  Patterns inserted : ${total}`);
    console.log(`  DB reported size  : ${finalSize}`);
    console.log(`  Path              : ${DB_PATH}`);
    if (finalSize !== total) {
        console.warn(`[phase15-seed] WARNING: db.len() (${finalSize}) ≠ inserted (${total}). ` +
            'Check for ID collisions or pre-existing data.');
    }
}
// ── Entrypoint ────────────────────────────────────────────────────────────────
const dryRun = process.argv.includes('--dry-run');
seed(dryRun).catch(err => {
    console.error('[phase15-seed] FATAL:', err);
    process.exit(1);
});
