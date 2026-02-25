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
/** Undirected weighted edge for the micro-graph. */
export interface MicroGraphEdge {
    u: number;
    v: number;
    weight: number;
}
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
export declare function stoerWagnerMinCut(n: number, edges: MicroGraphEdge[]): number;
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
export declare function buildStarGraph(cosineDistances: number[]): {
    n: number;
    edges: MicroGraphEdge[];
};
/**
 * Convenience: compute λ directly from k-NN cosine distances via a star graph.
 *
 * For a star graph the minimum cut equals the minimum edge weight, i.e., the
 * weakest similarity link between the query and its neighborhood.
 *
 * Returns 0 for empty input (fail-open, non-blocking).
 */
export declare function localMinCutLambda(cosineDistances: number[]): number;
