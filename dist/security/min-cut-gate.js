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
};
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
export function polylogThreshold(n) {
    if (n <= 1)
        return 1;
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
export function estimateLambda(knnDistances) {
    if (knnDistances.length === 0)
        return 0;
    const avg = knnDistances.reduce((a, b) => a + b, 0) / knnDistances.length;
    return avg > 1e-9 ? 1 / avg : Number.MAX_SAFE_INTEGER;
}
/**
 * λ-gated router with hysteresis.
 *
 * Hysteresis prevents oscillation at the threshold boundary:
 *   - To ENTER MinCut_Gate: λ must exceed threshold × (1 + 0.10)
 *   - To EXIT  MinCut_Gate: λ must fall below threshold × (1 - 0.10)
 */
export class MinCutGate {
    lastRoute = 'L3_Gate';
    hysteresisBand = 0.10;
    decide(knnDistances, dbSize) {
        const lambda = estimateLambda(knnDistances);
        const threshold = polylogThreshold(dbSize);
        const effectiveThreshold = this.lastRoute === 'L3_Gate'
            ? threshold * (1 + this.hysteresisBand) // must exceed to switch in
            : threshold * (1 - this.hysteresisBand); // must drop below to switch out
        const route = lambda >= effectiveThreshold ? 'MinCut_Gate' : 'L3_Gate';
        this.lastRoute = route;
        return {
            route,
            lambda,
            threshold,
            db_size: dbSize,
            reason: route === 'MinCut_Gate'
                ? `λ=${lambda.toFixed(3)} ≥ ${effectiveThreshold.toFixed(3)} — superpolylogarithmic, MinCut active`
                : `λ=${lambda.toFixed(3)} < ${effectiveThreshold.toFixed(3)} — below threshold, L3 fallback`,
        };
    }
    /** Reset hysteresis state (useful for tests). */
    reset() {
        this.lastRoute = 'L3_Gate';
    }
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
    reason = null;
    escalate(reason) {
        if (!this.escalated) {
            this.escalated = true;
            this.reason = reason;
        }
    }
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
export function applyConsensusVoting(input) {
    const { ratioResult, lambda, starLambda } = input;
    const votes = [];
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
export async function runGate(decision, l3Verdict, _embedding) {
    if (decision.route === 'MinCut_Gate') {
        // TODO: ruvector-mincut-wasm not installed — honest fallback to L3 verdict.
        // When installed, replace this block with the WASM coherence computation.
        console.warn('[MinCutGate] MinCut_Gate selected but ruvector-mincut-wasm not installed; ' +
            'falling back to L3_Gate verdict. Install @ruvector/mincut-wasm to activate.');
        return { ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda };
    }
    return { ...l3Verdict, gate: 'L3_Gate_fallback', lambda: decision.lambda };
}
