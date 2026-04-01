/**
 * Phase P9 — Motha'Ship PoC Server
 *
 * HTTP entry point that wires Layer 1.5 (EphemeralCache) and the real LLM
 * Surgeon (Gemini 2.5 Flash) into a single local server the mock RuvBot can hit.
 *
 * Request flow (P9):
 *   POST /poc/submit  (application/octet-stream)
 *     1. Approved-set check    — if fingerprint was promoted: blocked  (<1ms)
 *     2. Layer 1.5             — SHA-256 cache check → if seen: cached_blocked  (<1ms)
 *     3. Layer 1 (aidefence)   — TF-IDF embedding + ReflexionMemory KNN vote  (<12ms)
 *                                  if KNN denies (≥0.75 conf): quarantined, Surgeon skipped
 *                                  Surgeon verdicts feed back into ReflexionMemory + AgentDB
 *     4. LLM Surgeon           — Gemini (or StubSurgeon); result feeds ReflexionMemory
 *
 * P9 additions (closes AQE Gaps 2 & 3):
 *   - Corpus pre-load: 809 known attack patterns embedded into ReflexionMemory at startup
 *     so Layer 1 KNN boots warm instead of empty (Gap 2: Cold-Start Amnesia).
 *   - AgentDB persistence: Surgeon-learned patterns stored to AgentDBClient AND to
 *     data/learned-patterns.json. On restart, learned-patterns.json hydrates
 *     ReflexionMemory before the first request (Gap 3: Amnesia-on-Restart).
 *     NOTE: AgentDBClient currently resolves to an in-memory stub (the native
 *     @agentdb/core SQLite backend is not yet published). When Ruv ships native
 *     AgentDB, the JSON bridge can be dropped and this line updated to use the
 *     path config directly.
 *
 * Auxiliary endpoints (used by the Triage Dashboard in P4):
 *   GET  /poc/queue         — current quarantine queue (JSON)
 *   GET  /poc/stats         — cache + pipeline + Layer 1 statistics (JSON)
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
import { writeFile, readFile, mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { EphemeralCache } from '../../packages/host-rpc-server/src/ephemeral-cache.js'; // nosemgrep
import {
  createSurgeon, ISurgeon,
  ValidAttackType, VALID_ATTACK_TYPES,
  HazmatContext, HazmatClassificationResult, AdmissionDecision,
} from '../../packages/host-rpc-server/src/llm-surgeon.js'; // nosemgrep
import type { RuPiSignal } from '../../packages/host-rpc-server/src/ru-pi-coherence.js'; // nosemgrep
import {
  runPipeline, STUB_POLICY,
} from '../../packages/host-rpc-server/src/ruclawfleet-pipeline.js'; // nosemgrep
import type { RuClawRoleType } from '../../packages/host-rpc-server/src/ruclawfleet-types.js'; // nosemgrep
import { HazmatEnvelopeSchema, validateFreshness, JournalismReportSchema } from '../../packages/common-types/src/index.js'; // nosemgrep

// Type-only imports — erased at runtime, no ESM/CJS issue. // nosemgrep: hono CVEs are in server mode only; we use library API
import type { AgentDBConfig, ThreatIncident, AIMDSRequest, DefenseResult, ReflexionMemoryEntry } from 'aidefence';

// aidefence's ESM bundle (dist/esm/lib.js) uses dynamic require() of Node built-ins,
// which is not supported in native ESM.  All runtime values must come from the CJS
// build via createRequire.  Types above are erased and are fine as ESM import type.
const _cjsRequire = createRequire(import.meta.url);
const {
  EmbeddingService, ReflexionMemory, ThreatLevel,
  AgentDBClient, Logger,
} = _cjsRequire('aidefence') as typeof import('aidefence');

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '../..');

const QUARANTINE_FILE       = join(ROOT, '.claude-flow/data/quarantine-queue.json');
const HAZMAT_LOG_FILE       = join(ROOT, '.claude-flow/data/hazmat-log.jsonl');
const PIPELINE_RECORDS_FILE = join(ROOT, '.claude-flow/data/pipeline-records.jsonl');
const REPORTS_FILE          = join(ROOT, '.claude-flow/data/journalism-reports.jsonl');
const DATA_DIR              = join(ROOT, 'data');
const LEARNED_PATTERNS_FILE = join(DATA_DIR, 'learned-patterns.json');
const THREATS_DB_PATH       = join(DATA_DIR, 'threats.db');
const CORPUS_FILE           = join(ROOT, 'scripts/data/red-team-prompts.json');

// ---------------------------------------------------------------------------
// Corpus type (matches scripts/data/red-team-prompts.json schema)
// ---------------------------------------------------------------------------

interface CorpusAttack {
  id:       number;
  category: string;
  prompt:   string;
}

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

// VALID_ATTACK_TYPES is now the canonical export from llm-surgeon.ts.
// Re-exported here so existing imports of poc-server continue to work.
export { VALID_ATTACK_TYPES };

/** Active server-side policy version — stamped onto every HazmatClassificationResult. */
const POLICY_VERSION = '1.0.0';

/** Pure gate function: returns true only when a Surgeon verdict is safe to
 *  persist into ReflexionMemory / AgentDB / learned-patterns.json.
 *  Exported for unit testing. */
export function shouldLearnFromSurgeon(result: { confidence: number; attackType: string }): boolean {
  return (
    result.confidence >= 0.70 &&
    result.attackType !== 'benign' &&
    VALID_ATTACK_TYPES.has(result.attackType as ValidAttackType)
  );
}

/**
 * Apply the 4-category admission policy to a HazmatClassificationResult.
 * Returns operational flags — callers must NOT use analystNote to drive policy.
 *
 * Category rules (DO NOT COLLAPSE with classification or propagation):
 *   drop      — pre-condition checks failed, or cannot determine a usable category
 *   quarantine — any non-benign attackType (suspicion established at boundary)
 *   admit     — benign classification
 *   promote   — NOT automatic; operator action only (never returned by this function)
 *
 * Exported for unit testing.
 */
export function applyAdmissionPolicy(
  r: HazmatClassificationResult,
  ruPiSignal?: RuPiSignal,
): AdmissionDecision {
  // Drop: pre-condition checks failed — classification is suspect, do not proceed
  if (r.checksFailed.length > 0) {
    return {
      category:                 'drop',
      retainRaw:                true,
      createNormalizedArtifact: false,
      emitWitness:              true,
      allowPropagation:         false,
      requireHumanReview:       true,
      reason: `Pre-condition checks failed: ${r.checksFailed.join(', ')}`,
    };
  }

  // Ru Pi: suspended privilege level forces denial regardless of classification
  if (ruPiSignal?.privilegeLevel === 'suspended') {
    return {
      category:                 'quarantine',
      retainRaw:                true,
      createNormalizedArtifact: true,
      emitWitness:              true,
      allowPropagation:         false,
      requireHumanReview:       true,
      reason: `Ru Pi coherence: suspended privilege (energyScore=${ruPiSignal.energyScore.toFixed(3)})`,
    };
  }

  // Admit: benign with any confidence band
  if (r.attackType === 'benign') {
    // Ru Pi: structurally sensitive contribution overrides benign classification
    if (ruPiSignal?.structurallySensitive === true) {
      return {
        category:                 'quarantine',
        retainRaw:                true,
        createNormalizedArtifact: true,
        emitWitness:              true,
        allowPropagation:         false,
        requireHumanReview:       true,
        reason: `Ru Pi coherence: structurally sensitive write detected (energyScore=${ruPiSignal.energyScore.toFixed(3)})`,
      };
    }
    return {
      category:                 'admit',
      retainRaw:                false,
      createNormalizedArtifact: false,
      emitWitness:              false,
      allowPropagation:         true,
      requireHumanReview:       false,
      reason: 'Benign classification — admitted under normal participation rules',
    };
  }

  // Quarantine: any non-benign attack type, confidence-stratified
  const requireHumanReview = r.confidenceBand === 'high' ||
    (r.confidenceBand === 'medium' && r.attackType !== 'unknown');
  return {
    category:                 'quarantine',
    retainRaw:                true,
    createNormalizedArtifact: true,
    emitWitness:              true,
    allowPropagation:         false,
    requireHumanReview,
    reason: `Quarantined: ${r.attackType} (${r.confidenceBand} confidence, source=${r.source})`,
  };
}

// ---------------------------------------------------------------------------
// P9 — AgentDB persistence helpers
// ---------------------------------------------------------------------------

/**
 * Read previously surgeon-learned patterns from disk and hydrate ReflexionMemory.
 * Called once at startup BEFORE preloadCorpus so corpus entries are the warm floor
 * and session-learned entries layer on top.
 */
async function loadLearnedPatterns(rm: ReflexionMemory): Promise<number> {
  let entries: ReflexionMemoryEntry[];
  try {
    const raw = await readFile(LEARNED_PATTERNS_FILE, 'utf-8');
    entries   = JSON.parse(raw) as ReflexionMemoryEntry[];
  } catch {
    return 0;  // First boot — file doesn't exist yet.
  }
  for (const entry of entries) rm.store(entry);
  return entries.length;
}

/**
 * Append a newly surgeon-learned pattern to the persistence file.
 * Uses read-modify-write (same pattern as quarantine-queue) to keep the
 * JSON array consistent.  Called only for Surgeon verdicts with conf >= 0.70.
 */
async function persistLearnedPattern(entry: ReflexionMemoryEntry): Promise<void> {
  let existing: ReflexionMemoryEntry[] = [];
  try {
    const raw = await readFile(LEARNED_PATTERNS_FILE, 'utf-8');
    existing  = JSON.parse(raw) as ReflexionMemoryEntry[];
  } catch { /* first write — start empty */ }
  existing.push(entry);
  await writeFile(LEARNED_PATTERNS_FILE, JSON.stringify(existing, null, 2), 'utf-8');
}

/**
 * Pre-load the 809 known attack corpus into ReflexionMemory so Layer 1 KNN
 * boots warm on every restart (closes AQE Gap 2: Cold-Start Amnesia).
 * Corpus patterns are NOT written to learned-patterns.json — they are
 * always re-embedded fresh from the canonical JSON file.
 */
async function preloadCorpus(
  rm:   ReflexionMemory,
  emb:  EmbeddingService,
  adb:  AgentDBClient,
): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(CORPUS_FILE, 'utf-8');
  } catch {
    console.warn('[P9 CORPUS]  red-team-prompts.json not found — skipping pre-load.');
    return 0;
  }
  const { attacks }: { attacks: CorpusAttack[] } = JSON.parse(raw);

  for (const attack of attacks) {
    const embedding = emb.generateEmbedding(attack.prompt);

    // Store in in-memory KNN fast-path.
    rm.store({
      trajectory: attack.prompt.slice(0, 200),
      verdict:    'failure',
      feedback:   `corpus:${attack.category}`,
      embedding,
      metadata:   { corpusId: attack.id, category: attack.category, source: 'corpus' },
    });

    // Wire into AgentDBClient (ecosystem integration layer).
    // When native @agentdb/core ships with real SQLite, this provides the
    // persistent HNSW index automatically — no code change required here.
    const syntheticRequest: AIMDSRequest = {
      id:        `corpus-${attack.id}`,
      timestamp: 0,
      source:    { ip: '0.0.0.0', headers: {} },
      action:    { type: 'corpus-seed', resource: attack.category, method: 'preload' },
    };
    const syntheticResult: DefenseResult = {
      allowed:   false,
      confidence: 0.90,
      latencyMs:  0,
      threatLevel: ThreatLevel.HIGH,
      matches:    [],
      metadata:  { vectorSearchTime: 0, verificationTime: 0, totalTime: 0, pathTaken: 'fast' },
    };
    const incident: ThreatIncident = {
      id:        `corpus-${attack.id}`,
      timestamp: 0,
      request:   syntheticRequest,
      result:    syntheticResult,
      embedding,
    };
    await adb.storeIncident(incident);
  }

  return attacks.length;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Maximum request body: 1 MiB. Prevents memory-exhaustion DoS on all endpoints. */
const MAX_BODY_BYTES = 1_048_576;

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;
    req.on('data', (c: Buffer) => {
      totalSize += c.byteLength;
      if (totalSize > MAX_BODY_BYTES) {
        req.destroy();
        const err = Object.assign(new Error('Request body exceeds 1 MiB limit'), { code: 'BODY_TOO_LARGE' });
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end',   ()          => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Strip ANSI escape sequences and ASCII control characters from a string
 * before use in log lines or key concatenation. Prevents log injection and
 * terminal hijacking via attacker-controlled fields (e.g. source_node_id).
 */
function sanitizeForLog(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')   // ANSI CSI sequences
    .replace(/[\x00-\x1f\x7f]/g, '_');         // remaining control characters
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

    // ── Layer 1: aidefence fast-path (TF-IDF + ReflexionMemory KNN) ──────
    const l1Embedding = embeddingService.generateEmbedding(text);
    const l1Verdict   = reflexionMemory.generateVerdict(l1Embedding, ThreatLevel.NONE);
    const l1Ms        = Date.now() - t0;

    if (l1Verdict.decision === 'deny' && l1Verdict.confidence >= 0.75) {
      console.log(
        `[L1 BLOCK ]  ${fp.slice(0, 16)}…  conf=${l1Verdict.confidence.toFixed(2)}  (${l1Ms}ms)`,
      );
      const l1Entry = await enqueue(text, {
        attackType:     'known-pattern',
        coreIntent:     l1Verdict.reasoning.join('; ') || 'Matched known attack pattern in ReflexionMemory',
        recommendation: 'Blocked by Layer 1 aidefence KNN vote — Surgeon not invoked',
        confidence:     l1Verdict.confidence,
        source:         'aidefence-l1',
      });
      jsonResponse(res, 200, {
        result:      'quarantined',
        fingerprint: fp,
        ms:          l1Ms,
        quarantineId: l1Entry.id,
        l1: { verdict: 'deny', confidence: l1Verdict.confidence },
        message:     'Blocked by Layer 1 aidefence fast-path — Surgeon not invoked.',
      });
      return;
    }

    // ── Layer 2: LLM Surgeon ──────────────────────────────────────────────
    let surgeonResult;
    try {
      surgeonResult = await surgeon.analyze(text);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[SURGEON  ]  Error: ${errMsg} — falling back to stub`);
      const { StubSurgeon } = await import('../../packages/host-rpc-server/src/llm-surgeon.js'); // nosemgrep
      surgeonResult = await new StubSurgeon().analyze(text);
    }

    const entry = await enqueue(text, surgeonResult);

    // Learning loop: feed high-confidence Surgeon verdicts back to ReflexionMemory,
    // AgentDB, and the JSON persistence file.
    // Only store when confidence >= 0.70 — borderline results would corrupt KNN model.
    if (shouldLearnFromSurgeon(surgeonResult)) {
      const learnedEntry: ReflexionMemoryEntry = {
        // Strip control chars from trajectory — the KNN embedding is what matters;
        // the raw text is for human review only and must not carry prompt injection.
        trajectory: text.slice(0, 200).replace(/[\x00-\x1f\x7f]/g, ' '),
        verdict:    'failure',
        feedback:   `${surgeonResult.attackType}: ${surgeonResult.coreIntent}`,
        embedding:  l1Embedding,
        metadata:   {
          attackType: surgeonResult.attackType,
          confidence: surgeonResult.confidence,
          source:     surgeonResult.source,
        },
      };

      // In-memory KNN fast-path (immediate effect this session).
      reflexionMemory.store(learnedEntry);

      // AgentDB (ecosystem integration; real SQLite when native @agentdb/core ships).
      const incidentRequest: AIMDSRequest = {
        id:        randomUUID(),
        timestamp: Date.now(),
        source:    { ip: '127.0.0.1', headers: {} },
        action:    { type: 'threat-submission', resource: 'poc/submit', method: 'POST', payload: text.slice(0, 200) },
      };
      const incidentResult: DefenseResult = {
        allowed:    false,
        confidence: surgeonResult.confidence,
        latencyMs:  Date.now() - t0,
        threatLevel: ThreatLevel.HIGH,
        matches:    [],
        metadata:   { vectorSearchTime: 0, verificationTime: 0, totalTime: Date.now() - t0, pathTaken: 'deep' },
      };
      agentDB.storeIncident({
        id:        entry.id,
        timestamp: Date.now(),
        request:   incidentRequest,
        result:    incidentResult,
        embedding: l1Embedding,
      }).catch(err => console.warn('[P9 AGENTDB]  storeIncident failed:', err instanceof Error ? err.message : String(err)));

      // Disk persistence — survives server restart (closes AQE Gap 3).
      persistLearnedPattern(learnedEntry).catch(err =>
        console.warn('[P9 PERSIST]  failed to write learned-patterns.json:', err instanceof Error ? err.message : String(err)),
      );
    }

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
    const queue     = await readQueue();
    const l1Stats   = reflexionMemory.getStats();
    const adbStats  = await agentDB.getStats();
    jsonResponse(res, 200, {
      cache: {
        size:        cache.size,
        totalChecks: cache.totalChecks,
        totalHits:   cache.totalHits,
        hitRate:     cache.totalChecks > 0
          ? `${((cache.totalHits / cache.totalChecks) * 100).toFixed(1)}%`
          : '0%',
      },
      layer1: {
        corpusLoaded:        l1BootStats.corpusLoaded,
        sessionLearnedLoaded: l1BootStats.sessionLearnedLoaded,
        totalMemories:       l1Stats.totalMemories,
        failurePatterns:     l1Stats.failureCount,
      },
      agentDB: {
        incidents: adbStats.incidents,
        patterns:  adbStats.patterns,
        backend:   adbStats.backend,
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
  const promoteMatch = url.match(/^\/poc\/promote\/([^/]+)$/);
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
  const discardMatch = url.match(/^\/poc\/discard\/([^/]+)$/);
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

  // ── POST /poc/clear ───────────────────────────────────────────────────────
  // Demo reset: marks all pending entries as discarded so the queue starts
  // fresh without restarting the server.
  if (req.method === 'POST' && url === '/poc/clear') {
    const queue = await readQueue();
    const pendingCount = queue.filter(e => e.status === 'pending').length;
    const cleared = queue.map(e =>
      e.status === 'pending' ? { ...e, status: 'discarded' as const } : e,
    );
    await persistQueue(cleared);
    console.log(`[CLEAR    ]  Discarded ${pendingCount} pending entries (demo reset)`);
    jsonResponse(res, 200, { cleared: pendingCount });
    return;
  }

  // ── POST /api/v1/telemetry/hazmat ─────────────────────────────────────────
  // Receives HazmatEnvelopes from any participant type. Validates structure +
  // freshness, classifies via analyzeHazmat(), applies admission policy, then
  // appends the full record to the internal hazmat log.
  //
  // Separation of concerns (DO NOT COLLAPSE):
  //   1. analyzeHazmat()        → HazmatClassificationResult  (classification)
  //   2. applyAdmissionPolicy() → AdmissionDecision            (admission)
  //   3. PropagationRecord      → (future — separate object)   (propagation)
  if (req.method === 'POST' && url === '/api/v1/telemetry/hazmat') {
    const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/json') {
      res.writeHead(415).end('Expected Content-Type: application/json');
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)).toString('utf-8'));
    } catch {
      res.writeHead(400).end('Invalid JSON');
      return;
    }

    const parsed = HazmatEnvelopeSchema.safeParse(body);
    if (!parsed.success) {
      console.log(`[HAZMAT   ]  REJECTED — schema validation failed`);
      jsonResponse(res, 422, { error: 'Invalid HazmatEnvelope', issues: parsed.error.issues });
      return;
    }

    const envelope = parsed.data;

    if (!validateFreshness(envelope)) {
      console.log(`[HAZMAT   ]  REJECTED — stale or future-dated envelope from ${envelope.metadata.source_node_id}`);
      jsonResponse(res, 422, { error: 'Envelope timestamp outside freshness window — possible replay attack' });
      return;
    }

    // Decode raw content from base64 payload for classification.
    const rawContent = Buffer.from(envelope.payload, 'base64').toString('utf-8');
    // Sanitize source_node_id before embedding in keys or log lines — prevents
    // JSONL log injection (newlines) and ANSI terminal spoofing.
    const safeNodeId = sanitizeForLog(envelope.metadata.source_node_id);
    const artifactId = safeNodeId + ':' + envelope.metadata.created_at;

    // Step 1 — Classification (analyzeHazmat)
    const hazmatContext: HazmatContext = {
      content:         rawContent,
      // participant_type is now in HazmatEnvelopeSchema as a validated enum.
      // Use the parsed value directly — no cast, no bypass of Zod schema.
      participantType: envelope.participant_type ?? 'unknown',
      interceptedBy:   String((envelope as Record<string, unknown>)['intercepted_by'] ?? 'unknown'),
      artifactId,
      policyVersion:   POLICY_VERSION,
    };
    const classification = await surgeon.analyzeHazmat(hazmatContext);

    // Step 2 — Admission decision (applyAdmissionPolicy)
    const admission = applyAdmissionPolicy(classification);

    // Step 3 — Pipeline: produce WitnessRecord chain + PropagationRecord.
    // Pass pre-computed classification and admission as closures to avoid a
    // second Surgeon call. runPipeline() is I/O-free — persistence is our job.
    // participant_type is validated by HazmatEnvelopeSchema — no secondary cast needed.
    const participantType: RuClawRoleType = envelope.participant_type ?? 'unknown';

    const pipelineResult = await runPipeline({
      content:         rawContent,
      participantId:   envelope.metadata.source_node_id,
      participantType,
      ingressPath:     '/api/v1/telemetry/hazmat',
      corpusVersion:   POLICY_VERSION,
      policy:          STUB_POLICY,
      classifier:      async () => classification,   // already computed above — no second Surgeon call
      admissionPolicy: ()      => admission,         // already computed above
    });

    // Persist pipeline records (append-only; authoritativeStore persistence is caller responsibility).
    const pipelineEntry = JSON.stringify({
      received_at:       new Date().toISOString(),
      rawArtifact:       { ...pipelineResult.rawArtifact, content: '<redacted>' },
      classificationRecord: pipelineResult.classificationRecord,
      admissionRecord:   pipelineResult.admissionRecord,
      propagationRecord: pipelineResult.propagationRecord,
      witnessChain:      pipelineResult.witnessChain,
    });
    await mkdir(dirname(PIPELINE_RECORDS_FILE), { recursive: true });
    await appendFile(PIPELINE_RECORDS_FILE, pipelineEntry + '\n', 'utf-8');

    // Append to internal hazmat log — classification and admission recorded separately.
    const logEntry = JSON.stringify({
      envelope:       { ...envelope, payload: '<redacted>' },  // never log decoded payload
      received_at:    new Date().toISOString(),
      source:         'PARTICIPANT_FIELD',
      classification,
      admission:      { category: admission.category, reason: admission.reason,
                        retainRaw: admission.retainRaw, emitWitness: admission.emitWitness,
                        requireHumanReview: admission.requireHumanReview },
    });
    await mkdir(dirname(HAZMAT_LOG_FILE), { recursive: true });
    await appendFile(HAZMAT_LOG_FILE, logEntry + '\n', 'utf-8');

    console.log(
      `[HAZMAT   ]  ${admission.category.toUpperCase()} from ${safeNodeId}` +
      ` attackType=${classification.attackType} conf=${classification.confidence.toFixed(2)}` +
      ` band=${classification.confidenceBand} source=${classification.source}`,
    );
    jsonResponse(res, 202, {
      accepted:          true,
      source_node_id:    safeNodeId,
      received_at:       new Date().toISOString(),
      admission_category: admission.category,
      require_human_review: admission.requireHumanReview,
    });
    return;
  }

  // ── POST /api/v1/reports/dispatch ──────────────────────────────────────────
  // Receives JournalismReports (clean interview output) from field RuvBots.
  // Validates structure, appends to reports log for downstream analysis.
  if (req.method === 'POST' && url === '/api/v1/reports/dispatch') {
    const ct = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    if (ct !== 'application/json') {
      res.writeHead(415).end('Expected Content-Type: application/json');
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse((await readBody(req)).toString('utf-8'));
    } catch {
      res.writeHead(400).end('Invalid JSON');
      return;
    }

    const parsed = JournalismReportSchema.safeParse(body);
    if (!parsed.success) {
      console.log(`[REPORT   ]  REJECTED — schema validation failed`);
      jsonResponse(res, 422, { error: 'Invalid JournalismReport', issues: parsed.error.issues });
      return;
    }

    const report = parsed.data;

    // Freshness check — same 5-minute window as HazmatEnvelope.
    const now = Date.now();
    const ts  = new Date(report.submitted_at).getTime();
    if (ts < now - 300_000 || ts > now + 60_000) {
      console.log(`[REPORT   ]  REJECTED — stale or future-dated report from ${report.source_node_id}`);
      jsonResponse(res, 422, { error: 'Report timestamp outside freshness window' });
      return;
    }

    // Append to reports log.
    const logEntry = JSON.stringify({
      ...report,
      received_at: new Date().toISOString(),
    });
    await mkdir(dirname(REPORTS_FILE), { recursive: true });
    await appendFile(REPORTS_FILE, logEntry + '\n', 'utf-8');

    console.log(`[REPORT   ]  Accepted report ${report.report_id} from ${report.source_node_id} (${report.beads.length} beads, profile: ${report.moltbook_profile_id})`);
    jsonResponse(res, 202, {
      accepted: true,
      report_id: report.report_id,
      bead_count: report.beads.length,
      received_at: new Date().toISOString(),
    });
    return;
  }

  res.writeHead(404).end('Not Found');
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

const args    = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const rawPort = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '', 10) : 3000;
if (portIdx >= 0 && (!Number.isFinite(rawPort) || rawPort < 1 || rawPort > 65535)) {
  console.error('[FATAL] --port requires a valid port number (1–65535)');
  process.exit(1);
}
const PORT = rawPort;

const cache            = new EphemeralCache();
const surgeon          = createSurgeon();

// Layer 1: aidefence fast-path components (P9).
// ReflexionMemory cap set to 1500: 809 corpus + ~500 session-learned + buffer.
const embeddingService = new EmbeddingService();
const reflexionMemory  = new ReflexionMemory(1500);

// AgentDB: ecosystem integration layer.  Path config is ready for when native
// @agentdb/core (SQLite backend) ships from Ruv.  Today the in-memory stub is
// used; learned-patterns.json provides the real disk persistence.
const agentDBConfig: AgentDBConfig = {
  path:        THREATS_DB_PATH,
  embeddingDim: 384,
  hnswConfig:  { m: 16, efConstruction: 200, efSearch: 50 },
  quicSync:    { enabled: false, peers: [], port: 0 },
  memory:      { maxEntries: 2000, ttl: 0 },
};
const agentDB = new AgentDBClient(agentDBConfig, new Logger('poc-server'));

// Populated during bootstrap; used by /poc/stats.
const l1BootStats = { corpusLoaded: 0, sessionLearnedLoaded: 0 };

const server = createServer((req, res) => {
  handle(req, res, surgeon).catch(err => {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'BODY_TOO_LARGE') {
      if (!res.headersSent) res.writeHead(413).end('Request body too large (limit: 1 MiB)');
      return;
    }
    console.error('[ERROR]', err instanceof Error ? err.message : String(err));
    if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
  });
});

async function bootstrap(): Promise<void> {
  // Ensure data/ directory exists.
  await mkdir(DATA_DIR, { recursive: true });

  // Initialize AgentDB HNSW index (async).
  await agentDB.initialize();

  // (1) Hydrate ReflexionMemory from previous session's surgeon-learned patterns.
  //     Runs BEFORE corpus pre-load so corpus is the warm floor.
  const sessionLoaded = await loadLearnedPatterns(reflexionMemory);
  l1BootStats.sessionLearnedLoaded = sessionLoaded;
  if (sessionLoaded > 0) {
    console.log(`[P9 HYDRATE]  Loaded ${sessionLoaded} session-learned patterns from disk.`);
  }

  // (2) Pre-load 809 known attack corpus into ReflexionMemory + AgentDB.
  //     Always runs fresh — corpus is not written to learned-patterns.json.
  const corpusLoaded = await preloadCorpus(reflexionMemory, embeddingService, agentDB);
  l1BootStats.corpusLoaded = corpusLoaded;
  if (corpusLoaded > 0) {
    console.log(`[P9 CORPUS ]  Pre-loaded ${corpusLoaded} attack patterns into Layer 1 KNN.`);
  }

  server.listen(PORT, '127.0.0.1', () => {
    const src = surgeon.constructor.name;
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log("║  Motha'Ship PoC Server — Phase P10                           ║");
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Submit:   POST http://127.0.0.1:${PORT}/poc/submit             ║`);
    console.log(`║  Queue:    GET  http://127.0.0.1:${PORT}/poc/queue              ║`);
    console.log(`║  Stats:    GET  http://127.0.0.1:${PORT}/poc/stats              ║`);
    console.log(`║  Flush:    POST http://127.0.0.1:${PORT}/poc/flush              ║`);
    console.log(`║  Promote:  POST http://127.0.0.1:${PORT}/poc/promote/:id        ║`);
    console.log(`║  Discard:  POST http://127.0.0.1:${PORT}/poc/discard/:id        ║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Hazmat:   POST http://127.0.0.1:${PORT}/api/v1/telemetry/hazmat║`);
    console.log(`║  Reports:  POST http://127.0.0.1:${PORT}/api/v1/reports/dispatch║`);
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Quarantine: ${QUARANTINE_FILE.slice(-50).padEnd(50)} ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n  Surgeon:  ${src}  (${src === 'GeminiSurgeon' ? 'gemini-2.5-flash' : 'heuristic stub'})`);
    console.log(`  Layer 1:  ${corpusLoaded} corpus + ${sessionLoaded} session-learned patterns loaded`);
    console.log(`  AgentDB:  ${THREATS_DB_PATH}`);
    console.log('  Waiting for RuvBots…\n');
  });
}

bootstrap().catch(err => {
  console.error('[STARTUP ERROR]', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
