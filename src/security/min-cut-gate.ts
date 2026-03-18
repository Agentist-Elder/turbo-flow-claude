/**
 * Phase 15 — Min-Cut Coherence Gate
 *
 * AISP spec reference: arXiv:2512.13105 (El-Hayek, Henzinger, Li)
 *   "Deterministic and Exact Fully-dynamic Minimum Cut of
 *    Superpolylogarithmic Size in Subpolynomial Time"
 *
 * Routing contract (from Phase 15 AISP ⟦Γ⟧):
 *   ∀ payload:
 *     λ < polylog(n)  ⇒ route(L3_Gate)    ∧ latency ≤ 5ms
 *     λ ≥ polylog(n)  ⇒ route(MinCut_Gate) ∧ latency ≤ 20ms
 *
 * @ruvector/mincut-wasm@0.1.0 published 2026-03-17.
 * Call initMinCutWasm() during boot (before app.listen()) to activate.
 * runGate() falls back to L3_Gate_fallback if WASM is not initialized.
 */

// ── WASM init ─────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { createRequire } from 'module';
// WasmMinCut (dynamic algorithm) panicked in Node.js on std::time::Instant
// (wasm32-unknown-unknown has no system clock). Fixed in ruvnet/RuVector PR #268
// (merged 2026-03-18): time_compat module replaces Instant with a monotonic counter.
// Upgrade path: once @ruvector/mincut-wasm@>0.1.0 is published, replace WasmLocalKCut
// with WasmMinCut in runGate() for the full dynamic Stoer-Wagner algorithm.
// WasmLocalKCut is pure graph-traversal — no time calls — works in Node.js today.
import { initSync, WasmLocalKCut } from '@ruvector/mincut-wasm';

let wasmInitialized = false;

/**
 * Load and initialize the @ruvector/mincut-wasm binary.
 *
 * Must be called once during MothaShip boot, before app.listen().
 * Safe to call multiple times (no-op after first successful init).
 * On failure, runGate() continues to fall back to L3_Gate_fallback.
 */
export function initMinCutWasm(): void {
  if (wasmInitialized) return;
  try {
    const req = createRequire(import.meta.url);
    const wasmPath = req.resolve('@ruvector/mincut-wasm/ruvector_mincut_wasm_bg.wasm');
    const wasmBytes = readFileSync(wasmPath);
    initSync({ module: wasmBytes });
    wasmInitialized = true;
  } catch (err) {
    console.warn('[MinCutGate] WASM init failed — falling back to L3_Gate_fallback:', err);
  }
}

/**
 * Return WASM initialization status for health checks and boot guards.
 *
 * Use this to gate app.listen() — if initialized is false, MinCut_Gate
 * will silently degrade to L3_Gate_fallback for all requests.
 *
 * Example boot guard:
 *   initMinCutWasm();
 *   const { initialized } = getWasmStatus();
 *   if (!initialized) console.error('[Boot] MinCut WASM failed to load — running degraded');
 *   app.listen(port);
 */
export function getWasmStatus(): { initialized: boolean } {
  return { initialized: wasmInitialized };
}

// ── AISP-specified constants ─────────────────────────────────────────────────

/** Total fast-path budget in ms (AISP: FastPath_Budget ≜ 20) */
export const FAST_PATH_BUDGET_MS = 20;

/**
 * Empirically calibrated threshold for semantic (ONNX) embeddings.
 *
 * With all-MiniLM-L6-v2 vectors in ruvbot-coherence.db (Phase 17 re-seeding):
 *   Attack prompts:  λ ≈ 2.1–4.5  (tight kNN cluster in semantic space)
 *   Clean prompts:   λ ≈ 1.2      (sparse — far from attack patterns)
 *
 * Setting SEMANTIC_COHERENCE_THRESHOLD = 2.0 cleanly bisects this range.
 * This replaces the (log₂n)² formula for the async auditor path, where
 * ONNX embeddings are used instead of the fast-path char-code proxy.
 *
 * The (log₂n)² formula is preserved in polylogThreshold() for backward
 * compat and is used by the fast-path MinCutGate (still char-code based).
 */
export const SEMANTIC_COHERENCE_THRESHOLD = 2.0;

/**
 * Partition Ratio Score threshold.
 *
 * ratio = d_clean / d_attack  (average cosine distances to k=5 neighbors)
 *
 * Interpretation:
 *   ratio > 1.0  → closer to known attacks than to clean reference → suspicious
 *   ratio ≤ 1.0  → farther from attacks than from clean patterns → benign
 *
 * Calibrated at 1.0 (the natural crossover point). The ratio is more
 * principled than raw λ because it normalises for corpus density differences:
 * a dense attack cluster and a sparse attack cluster both produce meaningful
 * signal relative to the clean reference baseline.
 *
 * Used by the async auditor in fireAndAudit() as the primary discriminant
 * when the clean reference DB is available; falls back to λ otherwise.
 */
export const PARTITION_RATIO_THRESHOLD = 1.0;

/**
 * Stoer-Wagner star-graph min-cut threshold for the async auditor fallback.
 *
 * Calibrated 2026-02-25 against the Phase 18 probe set (ONNX space):
 *   Attack prompts: star-λ = 0.513 – 0.726  (min 0.513)
 *   Clean prompts:  star-λ = 0.179 – 0.281  (max 0.281)
 *   Gap: 0.232. Midpoint: 0.397 → rounded to 0.40.
 *
 * Used only in the fireAndAudit() fallback branch (when the clean reference
 * DB is unavailable and partitionRatioScore() returns null). Provides a
 * second independent signal alongside the existing λ-avg (SEMANTIC_COHERENCE_THRESHOLD).
 */
export const STAR_MINCUT_THRESHOLD = 0.40;

/**
 * Maximum number of kNN distances accepted by runGate().
 *
 * Matches DB_CONFIG.efSearch (100) — the HNSW search never returns more
 * candidates than efSearch, so any caller supplying more has either
 * misconfigured the pipeline or is attempting a DoS via an oversized graph.
 * Exceeding this limit triggers L3_Gate_fallback, not a throw, so the server
 * stays responsive.
 */
export const MAX_KNN_DISTANCES = 100;

/**
 * Maximum valid cosine distance for MiniLM-L6-v2 normalized embeddings.
 *
 * all-MiniLM-L6-v2 produces unit vectors; cosine distance = 1 − cosine_sim
 * is therefore in [0, 1]. A distance > 1.0 indicates either un-normalized
 * vectors (embedding pipeline bug) or an attacker shifting output to force
 * all edge weights to 1e-9 (silent evasion, AQE Finding 4).
 * Distances in (1.0, 2.0] map to negative similarity — meaningless for
 * neighbor-based threat detection. Reject them; do not silently clamp.
 */
export const MAX_KNN_DISTANCE = 1.0;

/**
 * WasmLocalKCut cut-sum threshold for runGate() MinCut_Gate path.
 *
 * WasmLocalKCut.query(source) returns the sum of edge weights in local cuts
 * around the source node — a different metric from pure-TS star min-cut.
 *
 * Initial calibration (2026-03-17, synthetic probe set):
 *   Attack prompts: sum ≈ 2.11 – 2.79  (tight cluster → large cut sums)
 *   Clean prompts:  sum ≈ 0.64 – 0.71  (sparse → small cut sums)
 *   Conservative midpoint: 1.40
 *
 * TODO: recalibrate against real traffic after 48 hours of live MothaShip
 * data, following the same methodology as STAR_MINCUT_THRESHOLD (see
 * scripts/measure-lambda.ts). Do NOT lower below 1.0 without measuring
 * false-positive impact first.
 */
export const WASM_LOCAL_KCUT_THRESHOLD = 1.40;

/** L3 fallback gate budget in ms (AISP: L3_Budget ≜ 5) */
export const L3_BUDGET_MS = 5;

/**
 * VectorDB HNSW configuration contract.
 * AISP: DB_Config ≜ { m: 32, efConstruction: 200, efSearch: 100, maxElements: 1_000_000 }
 * m is FROZEN at DB creation — never change without rebuilding the index.
 */
export const DB_CONFIG = {
  m: 32,
  efConstruction: 200,
  efSearch: 100,
  maxElements: 1_000_000,
} as const;

// ── λ Estimation ─────────────────────────────────────────────────────────────

/**
 * Conservative superpolylogarithmic threshold: (log₂ n)²
 *
 * The arXiv:2512.13105 bound applies when min-cut λ > polylog(n).
 * Using (log₂ n)² as the threshold is conservative — the paper's
 * actual bound is ω(polylog), so any function that grows faster
 * than every polylog satisfies the precondition.
 *
 * For n = 630 synthetic patterns: threshold ≈ (log₂ 630)² ≈ 86.
 * For n = 0 (cold start):         threshold = 1 → always falls to L3.
 */
export function polylogThreshold(n: number): number {
  if (n <= 1) return 1;
  const log2n = Math.log2(n);
  return log2n * log2n;
}

/**
 * Estimate λ (min-cut proxy) from k-NN cosine distances.
 *
 * Proxy rationale: in a well-connected k-NN graph, the min-cut λ
 * correlates with cluster density. Tight clusters (small cosine
 * distances) produce high λ; sparse regions produce low λ.
 *
 * Formula: λ_proxy = 1 / avg_cosine_distance
 *   → small distances (close neighbors) → high λ
 *   → large distances (isolated point)  → low λ
 *
 * This is a density proxy until ruvector-mincut-wasm computes exact λ.
 */
export function estimateLambda(knnDistances: number[]): number {
  if (knnDistances.length === 0) return 0;
  // Runtime type guard: deserialized external data may carry non-number values
  // despite the TypeScript signature. Filter before reduce to prevent NaN
  // propagation that would silently poison the lambda estimate (AQE Finding 3).
  const numeric = knnDistances.filter(d => typeof d === 'number' && Number.isFinite(d));
  if (numeric.length === 0) return 0;
  const avg = numeric.reduce((a, b) => a + b, 0) / numeric.length;
  return avg > 1e-9 ? 1 / avg : Number.MAX_SAFE_INTEGER;
}

// ── Gate Routing ─────────────────────────────────────────────────────────────

export type GateRoute = 'L3_Gate' | 'MinCut_Gate';

export interface GateDecision {
  route: GateRoute;
  lambda: number;
  threshold: number;
  db_size: number;
  reason: string;
}

/**
 * λ-gated router with hysteresis.
 *
 * Hysteresis prevents oscillation at the threshold boundary:
 *   - To ENTER MinCut_Gate: λ must exceed threshold × (1 + 0.10)
 *   - To EXIT  MinCut_Gate: λ must fall below threshold × (1 - 0.10)
 */
export class MinCutGate {
  private lastRoute: GateRoute = 'L3_Gate';
  private readonly hysteresisBand = 0.10;

  decide(knnDistances: number[], dbSize: number): GateDecision {
    const lambda = estimateLambda(knnDistances);
    const threshold = polylogThreshold(dbSize);

    const effectiveThreshold =
      this.lastRoute === 'L3_Gate'
        ? threshold * (1 + this.hysteresisBand)   // must exceed to switch in
        : threshold * (1 - this.hysteresisBand);  // must drop below to switch out

    const route: GateRoute =
      lambda >= effectiveThreshold ? 'MinCut_Gate' : 'L3_Gate';

    this.lastRoute = route;

    return {
      route,
      lambda,
      threshold,
      db_size: dbSize,
      reason:
        route === 'MinCut_Gate'
          ? `λ=${lambda.toFixed(3)} ≥ ${effectiveThreshold.toFixed(3)} — superpolylogarithmic, MinCut active`
          : `λ=${lambda.toFixed(3)} < ${effectiveThreshold.toFixed(3)} — below threshold, L3 fallback`,
    };
  }

  /** Reset hysteresis state (useful for tests). */
  reset(): void {
    this.lastRoute = 'L3_Gate';
  }
}

// ── Gate Execution ────────────────────────────────────────────────────────────

export interface L3Verdict {
  blocked: boolean;
  reason: string;
}

export interface MinCutResult extends L3Verdict {
  gate: 'MinCut_Gate' | 'L3_Gate_fallback';
  lambda: number;
  /**
   * UTC epoch milliseconds (Date.now()) stamped by Node.js the moment the
   * gate verdict is produced.
   *
   * Required because the WASM module uses a monotonic counter (not a real
   * clock) since PR #268 — it cannot self-timestamp. All downstream telemetry
   * (HazmatEnvelopes, audit logs) MUST use this field; do not call Date.now()
   * again downstream or the envelope timestamp will drift from the actual
   * gate decision time.
   */
  verdictTimestamp: number;
}

/**
 * Execute the selected gate.
 *
 * When route === 'MinCut_Gate' and ruvector-mincut-wasm is available:
 *   import init, { minCutCoherence } from '@ruvector/mincut-wasm';
 *   await init();
 *   const coherence = await minCutCoherence(embedding, efSearch);
 *   return { blocked: coherence < COHERENCE_THRESHOLD, ... };
 *
 * Until that package is installed, we return the L3 verdict unchanged.
 * The routing decision is still tracked for observability.
 */
// ── Session Threat State ──────────────────────────────────────────────────────

/**
 * Lightweight shared mutable flag for GOAP pipeline abort signaling.
 *
 * The async semantic auditor runs concurrently with the fast-path gate.
 * If the ONNX kNN search returns λ ≥ SEMANTIC_COHERENCE_THRESHOLD after
 * the fast path has already cleared the payload, the auditor calls
 * escalate() and the pipeline checks this flag at each phase boundary.
 *
 * Design: first escalation wins (subsequent calls are no-ops so the
 * first reason is preserved in logs). Not thread-safe by design —
 * Node.js is single-threaded; concurrent Promises share this object
 * safely via the event loop.
 */
export class SessionThreatState {
  escalated = false;
  reason: string | null = null;

  escalate(reason: string): void {
    if (!this.escalated) {
      this.escalated = true;
      this.reason = reason;
    }
  }
}

// ── Consensus Voting ──────────────────────────────────────────────────────────

export interface ConsensusInput {
  /** Result from partitionRatioScore(); null when clean-reference DB is absent. */
  ratioResult: { ratio: number; d_attack: number; d_clean: number } | null;
  /** Lambda-avg from estimateLambda(knnDistances). */
  lambda: number;
  /** Star-lambda from localMinCutLambda(knnDistances). */
  starLambda: number;
}

export interface ConsensusResult {
  votes: string[];
  totalDiscriminants: number;
  consensusThreshold: number;
  shouldEscalate: boolean;
  /** True when at least one vote was cast but consensus threshold was not reached. */
  smokeOnly: boolean;
}

/**
 * Pure 2-of-3 consensus vote-counting for the async auditor.
 *
 * Exported for unit testing. Called by fireAndAudit() in main.ts.
 *
 * When clean-ref DB is present  (ratioResult !== null):
 *   totalDiscriminants = 3, consensusThreshold = 2 (2-of-3 required).
 * When clean-ref DB is absent   (ratioResult === null):
 *   totalDiscriminants = 2, consensusThreshold = 1 (1-of-2, original fallback).
 *
 * The ratio acts as a sensitive "smoke detector" (threshold 1.0). Escalation
 * requires corroboration from λ-avg or star-λ to prevent false positives on
 * educational security content (confirmed Sensitivity Stress Test 2026-02-25).
 */
export function applyConsensusVoting(input: ConsensusInput): ConsensusResult {
  const { ratioResult, lambda, starLambda } = input;
  const votes: string[] = [];

  if (ratioResult !== null && ratioResult.ratio > PARTITION_RATIO_THRESHOLD) {
    votes.push(`ratio=${ratioResult.ratio.toFixed(3)}>${PARTITION_RATIO_THRESHOLD}`);
  }
  if (lambda >= SEMANTIC_COHERENCE_THRESHOLD) {
    votes.push(`λ=${lambda.toFixed(2)}≥${SEMANTIC_COHERENCE_THRESHOLD}`);
  }
  if (starLambda >= STAR_MINCUT_THRESHOLD) {
    votes.push(`star-λ=${starLambda.toFixed(3)}≥${STAR_MINCUT_THRESHOLD}`);
  }

  const totalDiscriminants = ratioResult !== null ? 3 : 2;
  const consensusThreshold = ratioResult !== null ? 2 : 1;
  const shouldEscalate = votes.length >= consensusThreshold;

  return {
    votes,
    totalDiscriminants,
    consensusThreshold,
    shouldEscalate,
    smokeOnly: votes.length > 0 && !shouldEscalate,
  };
}

// ── Gate Execution ────────────────────────────────────────────────────────────

/**
 * Freeze a MinCutResult so downstream code cannot mutate blocked, reason,
 * or verdictTimestamp after the gate decision is made (AQE Finding 1 —
 * replay / prototype-pollution hardening).
 */
function freeze(result: MinCutResult): MinCutResult {
  return Object.freeze(result);
}

export async function runGate(
  decision: GateDecision,
  l3Verdict: L3Verdict,
  knnDistances: number[],
): Promise<MinCutResult> {
  if (decision.route === 'MinCut_Gate') {
    if (!wasmInitialized) {
      console.warn('[MinCutGate] MinCut_Gate selected but WASM not initialized — falling back to L3_Gate verdict. Call initMinCutWasm() at boot.');
      return freeze({ ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda, verdictTimestamp: Date.now() });
    }

    try {
      // DoS guard (AQE Finding 2): cap graph size before entering the WASM loop.
      // An attacker-influenced kNN source could supply hundreds of distances,
      // causing WasmLocalKCut to build a massive graph and hang the event loop.
      // MAX_KNN_DISTANCES matches efSearch — any excess is a pipeline misconfiguration
      // or an attack; fall back rather than process.
      if (knnDistances.length > MAX_KNN_DISTANCES) {
        console.warn(`[MinCutGate] knnDistances.length=${knnDistances.length} exceeds MAX_KNN_DISTANCES=${MAX_KNN_DISTANCES} — falling back to L3_Gate verdict.`);
        return freeze({ ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda, verdictTimestamp: Date.now() });
      }

      // Input validation: strip non-finite, negative, and out-of-range distances.
      // Distances > MAX_KNN_DISTANCE (1.0) indicate un-normalized vectors or an
      // attacker shifting embeddings to force all edge weights to 1e-9, producing
      // cutSum ≈ 0 and a silent blocked=false verdict (AQE Finding 4).
      // If no valid distances survive, fall back rather than return cutSum=0.
      const validDistances = knnDistances.filter(
        d => Number.isFinite(d) && d >= 0 && d <= MAX_KNN_DISTANCE,
      );
      if (validDistances.length === 0) {
        console.warn('[MinCutGate] No valid knnDistances after filtering — falling back to L3_Gate verdict.');
        return freeze({ ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda, verdictTimestamp: Date.now() });
      }

      // Build star graph via WasmLocalKCut: node 0 = query, nodes 1..k = kNN neighbors.
      // WasmLocalKCut.query(0n) returns local cuts around node 0. The sum of
      // cut_values discriminates attack clusters (high) from clean regions (low).
      // TODO: upgrade to WasmMinCut once @ruvector/mincut-wasm@>0.1.0 is published
      // (PR #268 merged 2026-03-18 — fixes std::time::Instant panic in Node.js).
      const lkc = new WasmLocalKCut(BigInt(10), 1000.0, 2.0);
      for (let i = 0; i < validDistances.length; i++) {
        // Clamp weight to (0, 1] — zero-weight edges are meaningless for min-cut.
        const weight = Math.min(1, Math.max(1e-9, 1 - validDistances[i]));
        lkc.insertEdge(BigInt(0), BigInt(i + 1), weight);
      }
      const cuts: Array<{ cut_value: number }> = lkc.query(BigInt(0)) ?? [];
      lkc.free();

      const cutSum = cuts.reduce((acc, c) => acc + c.cut_value, 0);

      // Stamp the verdict time NOW, immediately after WASM returns.
      // The WASM module uses a monotonic counter (not a real clock) since PR #268 —
      // it cannot self-timestamp. This is the authoritative gate decision time.
      const verdictTimestamp = Date.now();

      // High cut-sum → tight cluster near known attacks → blocked.
      // Calibrated: attack ≈ 2.11–2.79, clean ≈ 0.64–0.71. Threshold: 1.40 (conservative).
      const blocked = cutSum >= WASM_LOCAL_KCUT_THRESHOLD;
      return freeze({
        blocked,
        reason: `WASM MinCut: λ=${cutSum.toFixed(3)} ${blocked ? '>=' : '<'} threshold=${WASM_LOCAL_KCUT_THRESHOLD}`,
        gate: 'MinCut_Gate',
        lambda: cutSum,
        verdictTimestamp,
      });
    } catch (err) {
      console.warn('[MinCutGate] WASM computation error — falling back to L3_Gate verdict:', err);
      return freeze({ ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda, verdictTimestamp: Date.now() });
    }
  }

  return freeze({ ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda, verdictTimestamp: Date.now() });
}
