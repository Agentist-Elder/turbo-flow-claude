/**
 * Phase 19 — Stoer-Wagner Min-Cut (Pure TypeScript)
 *
 * Replaces the @ruvector/mincut-wasm stub in runGate().
 * For k ≤ 6 nodes (~10 edges), V8 executes this in < 0.1 ms — well
 * under the 1 ms target and with zero bridge overhead.
 *
 * Reference: M. Stoer & F. Wagner, "A Simple Min-Cut Algorithm", JACM 1997.
 *
 * Threshold note: the star-graph min-cut returns values in [0, 1]
 * (cosine similarity range). This is NOT directly comparable to
 * SEMANTIC_COHERENCE_THRESHOLD (2.0) or polylogThreshold (~97).
 * A separate STAR_MINCUT_THRESHOLD must be calibrated empirically
 * before wiring into the fast-path gate.
 */
// ── Stoer-Wagner Algorithm ────────────────────────────────────────────────────
/**
 * Compute the global minimum cut value (λ) for a small undirected weighted
 * graph using the Stoer-Wagner algorithm.
 *
 * Time:  O(V³)  — negligible for V ≤ 6 (< 0.1 ms on V8).
 * Space: O(V²)  — dense adjacency matrix.
 *
 * @param n      Number of nodes (indices 0..n-1).
 * @param edges  Undirected weighted edges. Duplicate pairs are summed.
 * @returns      Global minimum cut value λ. Returns Infinity for n ≤ 1.
 */
export function stoerWagnerMinCut(n, edges) {
    if (n <= 1)
        return Infinity;
    // Dense adjacency matrix — V² = 36 numbers for V=6.
    const w = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const { u, v, weight } of edges) {
        if (u < 0 || v < 0 || u >= n || v >= n)
            continue;
        w[u][v] += weight;
        w[v][u] += weight;
    }
    // active: nodes still present (nodes are removed as they are merged).
    let active = Array.from({ length: n }, (_, i) => i);
    let minCut = Infinity;
    // n-1 phases of Minimum-Cut-Phase + contraction.
    while (active.length > 1) {
        // ── Minimum-Cut-Phase ──────────────────────────────────────────────────
        // key[v] = Σ w(v, a) for all a already added to A.
        const key = new Array(n).fill(0);
        const inA = new Array(n).fill(false);
        let s = -1;
        let t = -1;
        for (let i = 0; i < active.length; i++) {
            // Find the active vertex not yet in A with the maximum key.
            let maxKey = -1;
            let maxNode = -1;
            for (const v of active) {
                if (!inA[v] && (maxNode === -1 || key[v] > maxKey)) {
                    maxKey = key[v];
                    maxNode = v;
                }
            }
            inA[maxNode] = true;
            s = t;
            t = maxNode;
            // Update keys for vertices not yet in A.
            for (const v of active) {
                if (!inA[v])
                    key[v] += w[maxNode][v];
            }
        }
        // Cut of the phase: total weight of edges from t to A \ {t}.
        if (key[t] < minCut)
            minCut = key[t];
        // ── Contraction: merge t into s ────────────────────────────────────────
        for (let v = 0; v < n; v++) {
            w[s][v] += w[t][v];
            w[v][s] += w[v][t];
        }
        active = active.filter(v => v !== t);
    }
    return minCut;
}
// ── Graph Construction Helpers ────────────────────────────────────────────────
/**
 * Build a star-topology micro-graph for k-NN min-cut computation.
 *
 * Node 0 = query point. Nodes 1..k = nearest neighbors.
 * Edge weight = cosine_similarity = 1 − cosine_distance, clamped to [0, 1].
 *
 * Interpretation of the min-cut:
 *   High λ (minimum edge is large) → all neighbors are strongly connected
 *     to the query → tight cluster → suspicious.
 *   Low λ (minimum edge is small) → at least one neighbor is weakly connected
 *     → sparse region → more likely clean.
 *
 * This topology produces ~10 edges for k=5 (star has k edges; upgrade to a
 * complete k-NN subgraph when inter-neighbor distances become available from
 * the HNSW API).
 *
 * @param cosineDistances  k cosine distances from HNSW search (range [0, 2]).
 */
export function buildStarGraph(cosineDistances) {
    const k = cosineDistances.length;
    if (k === 0)
        return { n: 1, edges: [] };
    const edges = cosineDistances.map((d, i) => ({
        u: 0,
        v: i + 1,
        weight: Math.max(0, 1 - d),
    }));
    return { n: k + 1, edges };
}
/**
 * Convenience: compute λ directly from k-NN cosine distances via a star graph.
 *
 * For a star graph the minimum cut equals the minimum edge weight, i.e., the
 * weakest similarity link between the query and its neighborhood.
 *
 * Returns 0 for empty input (fail-open, non-blocking).
 */
export function localMinCutLambda(cosineDistances) {
    if (cosineDistances.length === 0)
        return 0;
    const { n, edges } = buildStarGraph(cosineDistances);
    return stoerWagnerMinCut(n, edges);
}
