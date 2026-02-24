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
 * MinCut algorithm requires @ruvector/mincut-wasm — NOT YET INSTALLED.
 * Until that package is available, MinCut_Gate falls back to L3_Gate.
 * This is an honest fallback, not security theater: the routing
 * infrastructure is correct; only the final analysis step is stubbed.
 *
 * TODO (Phase 15 completion):
 *   npm install @ruvector/mincut-wasm
 *   Replace runMinCutGate stub below with actual WASM call.
 */

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
  const avg = knnDistances.reduce((a, b) => a + b, 0) / knnDistances.length;
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

export async function runGate(
  decision: GateDecision,
  l3Verdict: L3Verdict,
  _embedding: number[],
): Promise<MinCutResult> {
  if (decision.route === 'MinCut_Gate') {
    // TODO: ruvector-mincut-wasm not installed — honest fallback to L3 verdict.
    // When installed, replace this block with the WASM coherence computation.
    console.warn(
      '[MinCutGate] MinCut_Gate selected but ruvector-mincut-wasm not installed; ' +
      'falling back to L3_Gate verdict. Install @ruvector/mincut-wasm to activate.',
    );
    return { ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda };
  }

  return { ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda };
}
