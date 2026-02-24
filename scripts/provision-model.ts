/**
 * scripts/provision-model.ts
 * Phase 17: Supply-chain provisioning for all-MiniLM-L6-v2 ONNX model.
 *
 * Downloads the model to .claude-flow/data/models/, computes SHA-256 of every
 * ONNX file, and stores them in checksums.json for future supply-chain pinning.
 *
 * Usage:
 *   npx tsx scripts/provision-model.ts             # download + checksum
 *   npx tsx scripts/provision-model.ts --verify    # verify existing files only
 *
 * Rules:
 *   - FIRST RUN:  downloads model, verifies 384-dim output, writes checksums.json
 *   - SUBSEQUENT: reads checksums.json, verifies every .onnx file, exit 1 on mismatch
 *   - The model files (~80 MB) are git-ignored.
 *   - checksums.json IS committed — it pins the supply chain.
 */

import { createHash } from 'crypto';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

const MODEL_DIR     = join(process.cwd(), '.claude-flow', 'data', 'models');
const CHECKSUMS_FILE = join(MODEL_DIR, 'checksums.json');
const MODEL_ID      = 'Xenova/all-MiniLM-L6-v2';
const EXPECTED_DIMS = 384;

// ── Helpers ──────────────────────────────────────────────────────────

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash('sha256').update(buf).digest('hex');
}

async function findOnnxFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(d: string): Promise<void> {
    const entries = await readdir(d, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name.endsWith('.onnx')) {
        results.push(full);
      }
    }
  }
  if (existsSync(dir)) await walk(dir);
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const verifyOnly = process.argv.includes('--verify');

  await mkdir(MODEL_DIR, { recursive: true });

  const alreadyProvisioned = existsSync(CHECKSUMS_FILE);

  if (verifyOnly && !alreadyProvisioned) {
    console.error('[provision] checksums.json not found. Run without --verify to provision first.');
    process.exit(1);
  }

  // ── PROVISION PATH ──────────────────────────────────────────────

  if (!alreadyProvisioned) {
    console.log('[provision] === PROVISION MODE ===');
    console.log('[provision] Model:', MODEL_ID);
    console.log('[provision] Cache dir:', MODEL_DIR);
    console.log('[provision] Importing @huggingface/transformers...');

    // Dynamic import — keeps the module graph separate from @ruvector/gnn
    // at build time while still running the conflict check at import time.
    const { pipeline, env } = await import('@huggingface/transformers');

    env.cacheDir = MODEL_DIR;
    env.allowRemoteModels = true;

    console.log('[provision] Downloading model (first run ~80 MB, subsequent runs use cache)...');
    const extractor = await pipeline('feature-extraction', MODEL_ID, { device: 'cpu' });

    // Smoke test: verify the model produces 384-dim embeddings
    console.log('[provision] Running smoke test...');
    const output = await extractor('supply chain verification test', {
      pooling: 'mean',
      normalize: true,
    }) as { dims: number[]; data: Float32Array };

    const outputDim = output.dims[output.dims.length - 1];
    if (outputDim !== EXPECTED_DIMS) {
      console.error(`[provision] SMOKE TEST FAILED: expected ${EXPECTED_DIMS}-dim output, got ${outputDim}`);
      process.exit(1);
    }
    console.log(`[provision] Smoke test PASSED — output: [${output.dims.join(', ')}]`);

    // Hash every downloaded ONNX file
    const onnxFiles = await findOnnxFiles(MODEL_DIR);
    if (onnxFiles.length === 0) {
      console.error('[provision] No .onnx files found after download — unexpected layout');
      process.exit(1);
    }

    console.log(`[provision] Computing SHA-256 for ${onnxFiles.length} ONNX file(s):`);
    const fileChecksums: Record<string, string> = {};
    for (const f of onnxFiles) {
      const hash = await sha256File(f);
      const rel  = f.slice(MODEL_DIR.length + 1).replace(/\\/g, '/');
      fileChecksums[rel] = hash;
      console.log(`  ${rel}`);
      console.log(`    sha256: ${hash}`);
    }

    const manifest = {
      model:         MODEL_ID,
      provisionedAt: new Date().toISOString(),
      expectedDims:  EXPECTED_DIMS,
      files:         fileChecksums,
    };

    await writeFile(CHECKSUMS_FILE, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

    console.log('[provision]');
    console.log('[provision] checksums.json written to:', CHECKSUMS_FILE);
    console.log('[provision] NEXT STEP: review the checksums above, then commit checksums.json');
    console.log('[provision]   git add .claude-flow/data/models/checksums.json');
    console.log('[provision]   git commit -m "feat(phase-17): pin all-MiniLM-L6-v2 supply chain checksums"');
    console.log('[provision] PROVISION COMPLETE');
    return;
  }

  // ── VERIFY PATH ─────────────────────────────────────────────────

  console.log('[provision] === VERIFY MODE ===');
  const manifest = JSON.parse(await readFile(CHECKSUMS_FILE, 'utf-8')) as {
    model: string;
    provisionedAt: string;
    expectedDims: number;
    files: Record<string, string>;
  };

  console.log('[provision] Stored manifest:');
  console.log(`  model:         ${manifest.model}`);
  console.log(`  provisionedAt: ${manifest.provisionedAt}`);
  console.log(`  files:         ${Object.keys(manifest.files).length}`);

  let allOk = true;

  for (const [rel, expected] of Object.entries(manifest.files)) {
    const full = join(MODEL_DIR, rel);
    if (!existsSync(full)) {
      console.error(`[provision] MISSING: ${rel}`);
      allOk = false;
      continue;
    }
    const actual = await sha256File(full);
    if (actual === expected) {
      console.log(`[provision] OK: ${rel}`);
    } else {
      console.error(`[provision] CHECKSUM MISMATCH: ${rel}`);
      console.error(`  expected: ${expected}`);
      console.error(`  actual:   ${actual}`);
      allOk = false;
    }
  }

  if (!allOk) {
    console.error('[provision]');
    console.error('[provision] *** SUPPLY CHAIN VIOLATION DETECTED ***');
    console.error('[provision] One or more model files have changed since provisioning.');
    console.error('[provision] Do NOT use this model. Re-run provision after investigating.');
    process.exit(1);
  }

  console.log('[provision] All checksums verified. Supply chain intact.');
}

main().catch(err => {
  console.error('[provision] Fatal error:', err);
  process.exit(1);
});
