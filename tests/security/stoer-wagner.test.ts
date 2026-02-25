import { describe, it, expect } from 'vitest';
import {
  stoerWagnerMinCut,
  buildStarGraph,
  localMinCutLambda,
  type MicroGraphEdge,
} from '../../src/security/stoer-wagner.js';

// ── stoerWagnerMinCut ─────────────────────────────────────────────────────────

describe('stoerWagnerMinCut', () => {
  it('n=0 returns Infinity', () => {
    expect(stoerWagnerMinCut(0, [])).toBe(Infinity);
  });

  it('n=1 returns Infinity', () => {
    expect(stoerWagnerMinCut(1, [])).toBe(Infinity);
  });

  it('two-node graph: λ equals the single edge weight', () => {
    const edges: MicroGraphEdge[] = [{ u: 0, v: 1, weight: 5 }];
    expect(stoerWagnerMinCut(2, edges)).toBe(5);
  });

  it('path graph: min cut is the weakest edge', () => {
    // 0 -(3)- 1 -(4)- 2 -(2)- 3
    // Min cut: sever the 2-3 edge → λ = 2.
    const edges: MicroGraphEdge[] = [
      { u: 0, v: 1, weight: 3 },
      { u: 1, v: 2, weight: 4 },
      { u: 2, v: 3, weight: 2 },
    ];
    expect(stoerWagnerMinCut(4, edges)).toBe(2);
  });

  it('5-node two-cluster graph: bridge weight is the min cut', () => {
    // Cluster A: {0,1,2} fully connected, weight 10.
    // Cluster B: {3,4}   fully connected, weight 10.
    // Bridge:    1-3, weight 2.
    // Expected λ = 2 (sever the bridge).
    const edges: MicroGraphEdge[] = [
      { u: 0, v: 1, weight: 10 },
      { u: 0, v: 2, weight: 10 },
      { u: 1, v: 2, weight: 10 },
      { u: 3, v: 4, weight: 10 },
      { u: 1, v: 3, weight: 2 },
    ];
    expect(stoerWagnerMinCut(5, edges)).toBe(2);
  });

  it('complete K4 with uniform weights: λ = vertex degree', () => {
    // K4 with all edge weights = 1.
    // Each vertex has degree 3, so isolating any vertex costs 3.
    // Expected λ = 3.
    const edges: MicroGraphEdge[] = [
      { u: 0, v: 1, weight: 1 },
      { u: 0, v: 2, weight: 1 },
      { u: 0, v: 3, weight: 1 },
      { u: 1, v: 2, weight: 1 },
      { u: 1, v: 3, weight: 1 },
      { u: 2, v: 3, weight: 1 },
    ];
    expect(stoerWagnerMinCut(4, edges)).toBe(3);
  });

  it('duplicate edges are summed before computing', () => {
    // Two edges (0,1,2) + (0,1,3) should behave as (0,1,5).
    const edges: MicroGraphEdge[] = [
      { u: 0, v: 1, weight: 2 },
      { u: 0, v: 1, weight: 3 },
    ];
    expect(stoerWagnerMinCut(2, edges)).toBe(5);
  });

  it('out-of-range edge indices are ignored without throwing', () => {
    const edges: MicroGraphEdge[] = [
      { u: 0, v: 1, weight: 4 },
      { u: 0, v: 9, weight: 99 }, // index 9 is out of range for n=2
    ];
    expect(stoerWagnerMinCut(2, edges)).toBe(4);
  });

  it('is deterministic: identical inputs produce identical λ', () => {
    const edges: MicroGraphEdge[] = [
      { u: 0, v: 1, weight: 0.8 },
      { u: 0, v: 2, weight: 0.6 },
      { u: 1, v: 3, weight: 0.3 },
      { u: 2, v: 4, weight: 0.5 },
      { u: 3, v: 4, weight: 0.9 },
    ];
    const r1 = stoerWagnerMinCut(5, edges);
    const r2 = stoerWagnerMinCut(5, edges);
    expect(r1).toBe(r2);
  });
});

// ── buildStarGraph ────────────────────────────────────────────────────────────

describe('buildStarGraph', () => {
  it('k distances → k+1 nodes', () => {
    const { n } = buildStarGraph([0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(n).toBe(6);
  });

  it('produces exactly k edges', () => {
    const { edges } = buildStarGraph([0.2, 0.3, 0.4]);
    expect(edges).toHaveLength(3);
  });

  it('all edges have u=0 (star topology)', () => {
    const { edges } = buildStarGraph([0.1, 0.2, 0.3]);
    expect(edges.every(e => e.u === 0)).toBe(true);
  });

  it('converts cosine distance to similarity weight', () => {
    const { edges } = buildStarGraph([0.2]);
    expect(edges[0].weight).toBeCloseTo(0.8, 5);
  });

  it('clamps weight to 0 when distance > 1', () => {
    const { edges } = buildStarGraph([1.5]);
    expect(edges[0].weight).toBe(0);
  });

  it('zero distance → weight 1.0', () => {
    const { edges } = buildStarGraph([0.0]);
    expect(edges[0].weight).toBeCloseTo(1.0, 10);
  });

  it('empty distances → degenerate single-node graph', () => {
    const { n, edges } = buildStarGraph([]);
    expect(n).toBe(1);
    expect(edges).toHaveLength(0);
  });
});

// ── localMinCutLambda ─────────────────────────────────────────────────────────

describe('localMinCutLambda', () => {
  it('returns 0 for empty distances (fail-open)', () => {
    expect(localMinCutLambda([])).toBe(0);
  });

  it('star min-cut equals the minimum similarity edge', () => {
    // Distances: [0.2, 0.3, 0.7, 0.8, 0.9]
    // Similarities (weights): [0.8, 0.7, 0.3, 0.2, 0.1]
    // Min cut of a star = minimum weight = 0.1.
    const lambda = localMinCutLambda([0.2, 0.3, 0.7, 0.8, 0.9]);
    expect(lambda).toBeCloseTo(0.1, 5);
  });

  it('tight cluster (small distances) gives higher λ than sparse', () => {
    // Small distances → high similarities → high min-cut.
    const tightLambda = localMinCutLambda([0.05, 0.06, 0.07, 0.08, 0.09]);
    // Large distances → low similarities → low min-cut.
    const sparseLambda = localMinCutLambda([0.60, 0.70, 0.80, 0.90, 0.95]);
    expect(tightLambda).toBeGreaterThan(sparseLambda);
  });

  it('uniform distances: all edges equal, min-cut = that weight', () => {
    const d = 0.4;
    const lambda = localMinCutLambda([d, d, d, d, d]);
    expect(lambda).toBeCloseTo(1 - d, 5);
  });
});
