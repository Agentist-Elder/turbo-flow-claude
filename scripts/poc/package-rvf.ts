/**
 * Phase P5b — Motha'Ship RVF Packaging
 *
 * Exports the quarantine queue into a portable RVF vector store.
 * Each entry is stored with its SHA-256 fingerprint-derived vector and full
 * metadata, enabling semantic-style lookup by attack type or status in future
 * iterations when real embeddings are wired in.
 *
 * Vector encoding (PoC):
 *   32-dim float32 derived from the first 32 bytes of the SHA-256 fingerprint.
 *   Each byte is normalized to [0, 1].  Deterministic and consistent across
 *   runs — not semantically meaningful, but sufficient to demonstrate the RVF
 *   packaging workflow.
 *
 * WIRE-IN: Replace fingerprintToVector() with real ONNX embeddings from the
 *   main pipeline (packages/host-rpc-server) when wiring to production.
 *
 * Usage:
 *   npx tsx scripts/poc/package-rvf.ts [--output PATH] [--status all|pending|approved|discarded]
 *
 * Output:
 *   .claude-flow/data/quarantine.rvf.json  — RVF-ready manifest (default)
 *   Prints ingest summary to stdout.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuarantineEntry {
  id:             string;
  fingerprint:    string;
  preview:        string;
  attackType:     string;
  coreIntent:     string;
  recommendation: string;
  confidence:     number;
  receivedAt:     string;
  variantCount:   number;
  status:         'pending' | 'approved' | 'discarded';
  surgeonSource?: string;
}

export interface RvfEntry {
  id:       string;
  vector:   number[];
  metadata: Record<string, string | number | boolean>;
}

export interface RvfManifest {
  storeName:   string;
  dimensions:  number;
  metric:      'cosine';
  exportedAt:  string;
  entryCount:  number;
  entries:     RvfEntry[];
}

// ---------------------------------------------------------------------------
// Vector encoding
// ---------------------------------------------------------------------------

/**
 * Derive a 32-dim float32 vector from a SHA-256 hex fingerprint.
 * Each of the first 32 hex byte pairs is parsed and normalized to [0, 1].
 *
 * WIRE-IN: Replace with real ONNX text embeddings for semantic search.
 */
export function fingerprintToVector(fp: string): number[] {
  const byteCount = Math.floor(fp.length / 2);
  const vec: number[] = [];
  for (let i = 0; i < 32; i++) {
    const byteIdx = i % byteCount;
    const raw     = parseInt(fp.slice(byteIdx * 2, byteIdx * 2 + 2), 16);
    // XOR with a position-dependent salt when wrapping to break repetition
    const byte    = i < byteCount ? raw : (raw ^ ((i * 37 + 17) & 0xff));
    vec.push(byte / 255);
  }
  return vec;
}

// ---------------------------------------------------------------------------
// Queue reader
// ---------------------------------------------------------------------------

const QUARANTINE_FILE = join(ROOT, '.claude-flow/data/quarantine-queue.json');

async function readQueue(): Promise<QuarantineEntry[]> {
  const raw = await readFile(QUARANTINE_FILE, 'utf-8');
  return JSON.parse(raw) as QuarantineEntry[];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const args       = process.argv.slice(2);
const outputIdx  = args.indexOf('--output');
const OUTPUT     = outputIdx >= 0
  ? args[outputIdx + 1]!
  : join(ROOT, '.claude-flow/data/quarantine.rvf.json');
const statusIdx  = args.indexOf('--status');
const FILTER     = (statusIdx >= 0 ? args[statusIdx + 1] : 'all') as
  'all' | 'pending' | 'approved' | 'discarded';

async function main(): Promise<void> {
  const queue = await readQueue();
  const entries = FILTER === 'all'
    ? queue
    : queue.filter(e => e.status === FILTER);

  const rvfEntries: RvfEntry[] = entries.map(e => ({
    id:     e.id,
    vector: fingerprintToVector(e.fingerprint),
    metadata: {
      fingerprint:    e.fingerprint,
      attackType:     e.attackType,
      confidence:     e.confidence,
      status:         e.status,
      variantCount:   e.variantCount,
      receivedAt:     e.receivedAt,
      surgeonSource:  e.surgeonSource ?? 'unknown',
      // Preview truncated to fit metadata string limit
      preview:        e.preview.slice(0, 120),
    },
  }));

  const manifest: RvfManifest = {
    storeName:  'quarantine-vectors',
    dimensions: 32,
    metric:     'cosine',
    exportedAt: new Date().toISOString(),
    entryCount: rvfEntries.length,
    entries:    rvfEntries,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(manifest, null, 2), 'utf-8');

  // Summary
  const byStatus = {
    pending:   entries.filter(e => e.status === 'pending').length,
    approved:  entries.filter(e => e.status === 'approved').length,
    discarded: entries.filter(e => e.status === 'discarded').length,
  };
  const byType = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.attackType] = (acc[e.attackType] ?? 0) + 1;
    return acc;
  }, {});

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log("║  Motha'Ship RVF Packaging — Phase P5b                        ║");
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Entries exported:  ${String(rvfEntries.length).padEnd(41)} ║`);
  console.log(`║    pending:         ${String(byStatus.pending).padEnd(41)} ║`);
  console.log(`║    approved:        ${String(byStatus.approved).padEnd(41)} ║`);
  console.log(`║    discarded:       ${String(byStatus.discarded).padEnd(41)} ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Attack types:                                               ║');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
    const line = `    ${type}: ${count}`;
    console.log(`║  ${line.padEnd(62)} ║`);
  }
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Output: ${OUTPUT.slice(-54).padEnd(54)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n  Next: ingest into live RVF store with:');
  console.log('    mcp__rvf__rvf_create_store + mcp__rvf__rvf_ingest');
  console.log('  Or query the manifest directly for offline analysis.\n');
}

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
