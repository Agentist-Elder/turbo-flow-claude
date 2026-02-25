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
/** Total fast-path budget in ms (AISP: FastPath_Budget ≜ 20) */
export declare const FAST_PATH_BUDGET_MS = 20;
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
export declare const SEMANTIC_COHERENCE_THRESHOLD = 2;
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
export declare const PARTITION_RATIO_THRESHOLD = 1;
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
export declare const STAR_MINCUT_THRESHOLD = 0.4;
/** L3 fallback gate budget in ms (AISP: L3_Budget ≜ 5) */
export declare const L3_BUDGET_MS = 5;
/**
 * VectorDB HNSW configuration contract.
 * AISP: DB_Config ≜ { m: 32, efConstruction: 200, efSearch: 100, maxElements: 1_000_000 }
 * m is FROZEN at DB creation — never change without rebuilding the index.
 */
export declare const DB_CONFIG: {
    readonly m: 32;
    readonly efConstruction: 200;
    readonly efSearch: 100;
    readonly maxElements: 1000000;
};
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
export declare function polylogThreshold(n: number): number;
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
export declare function estimateLambda(knnDistances: number[]): number;
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
export declare class MinCutGate {
    private lastRoute;
    private readonly hysteresisBand;
    decide(knnDistances: number[], dbSize: number): GateDecision;
    /** Reset hysteresis state (useful for tests). */
    reset(): void;
}
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
export declare class SessionThreatState {
    escalated: boolean;
    reason: string | null;
    escalate(reason: string): void;
}
export declare function runGate(decision: GateDecision, l3Verdict: L3Verdict, _embedding: number[]): Promise<MinCutResult>;
