/**
 * Phase P3 — Motha'Ship PoC Server
 *
 * HTTP entry point that wires Layer 1.5 (EphemeralCache) and the real LLM
 * Surgeon (Gemini 2.5 Flash) into a single local server the mock RuvBot can hit.
 *
 * Request flow:
 *   POST /poc/submit  (application/octet-stream)
 *     1. Approved-set check  — if fingerprint was promoted: blocked  (<1ms)
 *     2. Layer 1.5           — SHA-256 cache check → if seen: cached_blocked  (<1ms)
 *     3. LLM Surgeon         — Gemini (or StubSurgeon if no API key)
 *
 * Auxiliary endpoints (used by the Triage Dashboard in P4):
 *   GET  /poc/queue         — current quarantine queue (JSON)
 *   GET  /poc/stats         — cache + pipeline statistics (JSON)
 *   POST /poc/flush         — flush SHA-256 cache (called after human approval)
 *   POST /poc/promote/:id   — approve a quarantine entry; adds to approved-set
 *                             (simulates "promote to ruvector-sec.db" for the demo)
 *   POST /poc/discard/:id   — discard a quarantine entry (no approved-set change)
 *
 * Quarantine queue is persisted to .claude-flow/data/quarantine-queue.json
 * so the separate P4 dashboard process can read and update it.
 *
 * Usage:
 *   npx tsx scripts/poc/poc-server.ts [--port 3000]
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EphemeralCache } from '../../packages/host-rpc-server/src/ephemeral-cache.js';
import { createSurgeon, ISurgeon } from '../../packages/host-rpc-server/src/llm-surgeon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');

const QUARANTINE_FILE = join(ROOT, '.claude-flow/data/quarantine-queue.json');

// ---------------------------------------------------------------------------
// Quarantine queue  (file-backed so P4 dashboard reads the same data)
// ---------------------------------------------------------------------------

export interface QuarantineEntry {
  id:             string;
  fingerprint:    string;
  /** First 200 chars of the raw attack text for dashboard display. */
  preview:        string;
  attackType:     string;
  coreIntent:     string;
  recommendation: string;
  confidence:     number;
  receivedAt:     string;
  /** Number of surface variants that mapped to this fingerprint. */
  variantCount:   number;
  status:         'pending' | 'approved' | 'discarded';
  /** 'gemini' | 'stub' — which surgeon produced the analysis. */
  surgeonSource:  string;
}

async function readQueue(): Promise<QuarantineEntry[]> {
  try {
    const raw = await readFile(QUARANTINE_FILE, 'utf-8');
    return JSON.parse(raw) as QuarantineEntry[];
  } catch {
    return [];
  }
}

async function persistQueue(entries: QuarantineEntry[]): Promise<void> {
  await mkdir(dirname(QUARANTINE_FILE), { recursive: true });
  await writeFile(QUARANTINE_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

async function enqueue(
  text:   string,
  result: { attackType: string; coreIntent: string; recommendation: string; confidence: number; source: string },
): Promise<QuarantineEntry> {
  const queue = await readQueue();
  const fp    = EphemeralCache.fingerprint(text);

  // If a pending entry already exists for this fingerprint, just bump the
  // variant counter rather than creating a duplicate cluster.
  const existing = queue.find(e => e.fingerprint === fp && e.status === 'pending');
  if (existing) {
    existing.variantCount++;
    await persistQueue(queue);
    return existing;
  }

  const entry: QuarantineEntry = {
    id:             randomUUID(),
    fingerprint:    fp,
    preview:        text.slice(0, 200),
    attackType:     result.attackType,
    coreIntent:     result.coreIntent,
    recommendation: result.recommendation,
    confidence:     result.confidence,
    receivedAt:     new Date().toISOString(),
    variantCount:   1,
    status:         'pending',
    surgeonSource:  result.source,
  };

  queue.push(entry);
  await persistQueue(queue);
  return entry;
}

// ---------------------------------------------------------------------------
// Approved-attacks set  (in-memory for demo; simulates ruvector-sec.db patch)
// ---------------------------------------------------------------------------

/**
 * Fingerprints of attacks that have been promoted by a human operator.
 * After promotion, subsequent requests with the same fingerprint are blocked
 * by the very first check — demonstrating the "Final Shield" (Step 5) of the PoC.
 */
const approvedAttacks = new Set<string>();

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data',  (c: Buffer) => chunks.push(c));
    req.on('end',   ()          => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(body);
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse, surgeon: ISurgeon): Promise<void> {
  const t0 = Date.now();
  const url = req.url ?? '';

  // ── POST /poc/submit ──────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/poc/submit') {
    const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/octet-stream') {
      res.writeHead(415).end('Expected Content-Type: application/octet-stream');
      return;
    }

    const body = await readBody(req);
    const text = body.toString('utf-8');
    const fp   = EphemeralCache.fingerprint(text);

    // ── Layer 0: Approved-set (post-patch block) ──────────────────────────
    if (approvedAttacks.has(fp)) {
      const ms = Date.now() - t0;
      console.log(`[APPROVED ]  ${fp.slice(0, 16)}…  (${ms}ms)  — post-patch block`);
      jsonResponse(res, 200, {
        result:      'blocked',
        fingerprint: fp,
        ms,
        message:     'Blocked by approved-attacks set — promoted from quarantine.',
      });
      return;
    }

    // ── Layer 1.5: SHA-256 cache ──────────────────────────────────────────
    const cacheResult = cache.check(text);

    if (cacheResult === 'seen') {
      const ms = Date.now() - t0;
      console.log(`[L1.5 HIT ]  ${fp.slice(0, 16)}…  (${ms}ms)`);
      jsonResponse(res, 200, {
        result:      'cached_blocked',
        fingerprint: fp,
        ms,
        message:     'Blocked by Layer 1.5 SHA-256 cache — Surgeon not invoked.',
      });
      return;
    }

    // Novel text — record fingerprint to catch incoming variants.
    cache.record(text);

    // ── Layer 2: LLM Surgeon ──────────────────────────────────────────────
    let surgeonResult;
    try {
      surgeonResult = await surgeon.analyze(text);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[SURGEON  ]  Error: ${errMsg} — falling back to stub`);
      const { StubSurgeon } = await import('../../packages/host-rpc-server/src/llm-surgeon.js');
      surgeonResult = await new StubSurgeon().analyze(text);
    }

    const entry = await enqueue(text, surgeonResult);

    const ms = Date.now() - t0;
    console.log(
      `[NOVEL    ]  ${fp.slice(0, 16)}…  type=${surgeonResult.attackType}` +
      `  conf=${surgeonResult.confidence.toFixed(2)}` +
      `  src=${surgeonResult.source}  (${ms}ms)`,
    );
    console.log(`             intent: ${surgeonResult.coreIntent.slice(0, 90)}`);

    jsonResponse(res, 200, {
      result:      'quarantined',
      fingerprint: fp,
      ms,
      quarantineId: entry.id,
      surgeon: {
        attackType:  surgeonResult.attackType,
        coreIntent:  surgeonResult.coreIntent,
        confidence:  surgeonResult.confidence,
        source:      surgeonResult.source,
      },
      message: 'Attack routed to quarantine queue. Awaiting human review in dashboard.',
    });
    return;
  }

  // ── GET /poc/queue ────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/poc/queue') {
    const queue = await readQueue();
    jsonResponse(res, 200, queue);
    return;
  }

  // ── GET /poc/stats ────────────────────────────────────────────────────────
  if (req.method === 'GET' && url === '/poc/stats') {
    const queue = await readQueue();
    jsonResponse(res, 200, {
      cache: {
        size:        cache.size,
        totalChecks: cache.totalChecks,
        totalHits:   cache.totalHits,
        hitRate:     cache.totalChecks > 0
          ? `${((cache.totalHits / cache.totalChecks) * 100).toFixed(1)}%`
          : '0%',
      },
      quarantine: {
        total:     queue.length,
        pending:   queue.filter(e => e.status === 'pending').length,
        approved:  queue.filter(e => e.status === 'approved').length,
        discarded: queue.filter(e => e.status === 'discarded').length,
      },
      approvedSet: {
        size: approvedAttacks.size,
      },
    });
    return;
  }

  // ── POST /poc/flush ───────────────────────────────────────────────────────
  if (req.method === 'POST' && url === '/poc/flush') {
    const sizeBefore = cache.size;
    cache.flush();
    console.log(`[FLUSH    ]  SHA-256 cache cleared (had ${sizeBefore} entries)`);
    jsonResponse(res, 200, { flushed: sizeBefore });
    return;
  }

  // ── POST /poc/promote/:id ─────────────────────────────────────────────────
  // Called by the Triage Dashboard after a human approves a quarantine entry.
  // Marks the entry as 'approved' in the queue, adds its fingerprint to the
  // in-memory approved-set so future requests are blocked at Layer 0.
  const promoteMatch = /^\/poc\/promote\/([^/]+)$/.exec(url);
  if (req.method === 'POST' && promoteMatch) {
    const id    = promoteMatch[1]!;
    const queue = await readQueue();
    const entry = queue.find(e => e.id === id);

    if (!entry) {
      jsonResponse(res, 404, { error: `No entry found with id: ${id}` });
      return;
    }

    entry.status = 'approved';
    approvedAttacks.add(entry.fingerprint);
    await persistQueue(queue);

    console.log(`[PROMOTE  ]  ${entry.fingerprint.slice(0, 16)}…  type=${entry.attackType}`);
    jsonResponse(res, 200, {
      promoted: true,
      id:          entry.id,
      fingerprint: entry.fingerprint,
      attackType:  entry.attackType,
      message:     'Entry approved and fingerprint added to blocked set.',
    });
    return;
  }

  // ── POST /poc/discard/:id ─────────────────────────────────────────────────
  const discardMatch = /^\/poc\/discard\/([^/]+)$/.exec(url);
  if (req.method === 'POST' && discardMatch) {
    const id    = discardMatch[1]!;
    const queue = await readQueue();
    const entry = queue.find(e => e.id === id);

    if (!entry) {
      jsonResponse(res, 404, { error: `No entry found with id: ${id}` });
      return;
    }

    entry.status = 'discarded';
    await persistQueue(queue);

    console.log(`[DISCARD  ]  ${entry.fingerprint.slice(0, 16)}…  id=${id}`);
    jsonResponse(res, 200, { discarded: true, id: entry.id });
    return;
  }

  res.writeHead(404).end('Not Found');
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const args    = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT    = portIdx >= 0 ? parseInt(args[portIdx + 1]!, 10) : 3000;

const cache   = new EphemeralCache();
const surgeon = createSurgeon();

const server = createServer((req, res) => {
  handle(req, res, surgeon).catch(err => {
    console.error('[ERROR]', err instanceof Error ? err.message : String(err));
    if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const src = surgeon.constructor.name;
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log("║  Motha'Ship PoC Server — Phase P3                            ║");
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Submit:   POST http://127.0.0.1:${PORT}/poc/submit             ║`);
  console.log(`║  Queue:    GET  http://127.0.0.1:${PORT}/poc/queue              ║`);
  console.log(`║  Stats:    GET  http://127.0.0.1:${PORT}/poc/stats              ║`);
  console.log(`║  Flush:    POST http://127.0.0.1:${PORT}/poc/flush              ║`);
  console.log(`║  Promote:  POST http://127.0.0.1:${PORT}/poc/promote/:id        ║`);
  console.log(`║  Discard:  POST http://127.0.0.1:${PORT}/poc/discard/:id        ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Quarantine: ${QUARANTINE_FILE.slice(-50).padEnd(50)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`\n  Surgeon: ${src}  (${src === 'GeminiSurgeon' ? 'gemini-2.5-flash' : 'heuristic stub'})`);
  console.log('  Waiting for RuvBots…\n');
});
