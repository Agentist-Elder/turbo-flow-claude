/**
 * Phase 18 — Clean Reference DB Seeder
 *
 * Seeds ruvbot-clean-reference.db with 50 ONNX semantic embeddings of benign
 * prompts. This DB provides the d_clean baseline for the Partition Ratio Score:
 *
 *   ratio = d_clean / d_attack
 *
 * A ratio > PARTITION_RATIO_THRESHOLD (1.0) means the input is semantically
 * closer to known attacks than to clean reference traffic — suspicious.
 *
 * Uses the same all-MiniLM-L6-v2 model as the attack DB seeder to ensure
 * both DBs share the same embedding space.
 *
 * Usage:
 *   npx tsx scripts/seed-clean-reference.ts [--dry-run]
 *
 * Requires: npx tsx scripts/provision-model.ts must have been run first.
 */

import { readFileSync, existsSync, copyFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { VectorDB } from 'ruvector';
import { pipeline, env } from '@huggingface/transformers';
import { normalizeInput } from '../src/security/vector-scanner.js';
import { DB_CONFIG } from '../src/security/min-cut-gate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DB_PATH  = join(ROOT, '.claude-flow/data/ruvbot-clean-reference.db');
const BAK_PATH = join(ROOT, '.claude-flow/data/ruvbot-clean-reference.db.bak');
const CORPUS   = join(__dirname, 'data/red-team-clean-reference.json');
const DRY_RUN  = process.argv.includes('--dry-run');

interface CleanPrompt {
  id: number;
  category: string;
  prompt: string;
}

// ── Load corpus ───────────────────────────────────────────────────────────────

if (!existsSync(CORPUS)) {
  console.error(`Corpus not found: ${CORPUS}`);
  process.exit(1);
}

const { clean_prompts }: { clean_prompts: CleanPrompt[] } = JSON.parse(readFileSync(CORPUS, 'utf-8'));
console.log(`Loaded ${clean_prompts.length} clean prompts from corpus.`);

// ── Load semantic embedding model ─────────────────────────────────────────────

const MODEL_DIR = join(ROOT, '.claude-flow/data/models');
env.cacheDir          = MODEL_DIR;
env.allowRemoteModels = false;

console.log('Loading all-MiniLM-L6-v2 from local cache…');
const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu' });
console.log('Model loaded.');

async function embed(text: string): Promise<number[]> {
  const out = await extractor(text, { pooling: 'mean', normalize: true }) as { data: Float32Array };
  return Array.from(out.data);
}

if (DRY_RUN) {
  console.log('[DRY RUN] No database changes will be made.');
  for (const p of clean_prompts.slice(0, 3)) {
    const norm = normalizeInput(p.prompt);
    const vec  = await embed(norm);
    const mag  = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    console.log(`  [${p.category}] "${p.prompt.slice(0, 60)}…" → norm=${mag.toFixed(4)}`);
  }
  process.exit(0);
}

// ── Backup and remove existing DB ────────────────────────────────────────────

mkdirSync(dirname(DB_PATH), { recursive: true });

if (existsSync(DB_PATH)) {
  copyFileSync(DB_PATH, BAK_PATH);
  console.log(`Backed up existing DB → ${BAK_PATH}`);
  unlinkSync(DB_PATH);
  console.log('Removed old clean reference DB.');
}

// ── Open fresh VectorDB ───────────────────────────────────────────────────────

const db = new VectorDB({
  storagePath:    DB_PATH,
  dimensions:     384,
  distanceMetric: 'Cosine',
  hnswConfig: {
    m:              DB_CONFIG.m,
    efConstruction: DB_CONFIG.efConstruction,
    efSearch:       DB_CONFIG.efSearch,
    maxElements:    DB_CONFIG.maxElements,
  },
});

console.log('Opened fresh VectorDB. Inserting clean reference vectors…');

// ── Insert clean vectors ──────────────────────────────────────────────────────

let inserted = 0;
const categoryCount: Record<string, number> = {};

for (const p of clean_prompts) {
  const normalized = normalizeInput(p.prompt);
  const vector     = await embed(normalized);

  await db.insert({
    id:       `clean:${p.id}`,
    vector,
    metadata: {
      category: p.category,
      raw:      p.prompt.slice(0, 200),
    },
  });

  inserted++;
  categoryCount[p.category] = (categoryCount[p.category] ?? 0) + 1;
}

// ── Verify DB size ────────────────────────────────────────────────────────────

const dbSize = await db.len();
console.log(`\nSeeding complete.`);
console.log(`  DB size (db.len()): ${dbSize}`);
console.log(`  Inserted:           ${inserted}`);
for (const [cat, n] of Object.entries(categoryCount)) {
  console.log(`    ${cat.padEnd(20)} ${n}`);
}

console.log(`\nDB path: ${DB_PATH}`);
