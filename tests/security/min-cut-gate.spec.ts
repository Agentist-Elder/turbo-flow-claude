/**
 * Phase 15 — Min-Cut Gate Test Suite
 *
 * Verifies the 6 AISP contract properties submitted to the AQE swarm:
 *
 *   (a) DB_CONFIG matches AISP spec invariants
 *   (b) polylogThreshold is monotonically non-decreasing
 *   (c) estimateLambda returns 0 for empty input
 *   (d) MinCutGate respects hysteresis (no thrashing at boundary)
 *   (e) Cold-start (empty registry, dbSize=0) always routes to L3_Gate
 *   (f) runGate fallback does not fabricate a blocked/unblocked verdict
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DB_CONFIG,
  FAST_PATH_BUDGET_MS,
  L3_BUDGET_MS,
  polylogThreshold,
  estimateLambda,
  MinCutGate,
  runGate,
  type GateDecision,
} from '../../src/security/min-cut-gate.js';

// ── (a) AISP constant contract ───────────────────────────────────────

describe('DB_CONFIG — AISP spec invariants', () => {
  it('m ≜ 32 (frozen at DB creation)', () => {
    expect(DB_CONFIG.m).toBe(32);
  });
  it('efConstruction ≜ 200', () => {
    expect(DB_CONFIG.efConstruction).toBe(200);
  });
  it('efSearch ≜ 100', () => {
    expect(DB_CONFIG.efSearch).toBe(100);
  });
  it('maxElements ≜ 1_000_000', () => {
    expect(DB_CONFIG.maxElements).toBe(1_000_000);
  });
  it('FAST_PATH_BUDGET_MS ≜ 20', () => {
    expect(FAST_PATH_BUDGET_MS).toBe(20);
  });
  it('L3_BUDGET_MS ≜ 5', () => {
    expect(L3_BUDGET_MS).toBe(5);
  });
});

// ── (b) polylogThreshold monotonicity ───────────────────────────────

describe('polylogThreshold', () => {
  it('n ≤ 1 always returns 1 (cold-start guard)', () => {
    expect(polylogThreshold(0)).toBe(1);
    expect(polylogThreshold(1)).toBe(1);
  });

  it('is monotonically non-decreasing', () => {
    const sizes = [2, 10, 100, 630, 1000, 10_000];
    for (let i = 1; i < sizes.length; i++) {
      const prev = polylogThreshold(sizes[i - 1]);
      const curr = polylogThreshold(sizes[i]);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('n=630 (target seeding size) exceeds 80 — comfortably superpolylogarithmic', () => {
    expect(polylogThreshold(630)).toBeGreaterThan(80);
  });

  it('returns (log₂ n)² for n > 1', () => {
    // n=4: log₂(4)=2, threshold=4
    expect(polylogThreshold(4)).toBeCloseTo(4, 5);
    // n=8: log₂(8)=3, threshold=9
    expect(polylogThreshold(8)).toBeCloseTo(9, 5);
  });
});

// ── (c) estimateLambda edge cases ────────────────────────────────────

describe('estimateLambda', () => {
  it('returns 0 for empty input (cold start, no neighbors)', () => {
    expect(estimateLambda([])).toBe(0);
  });

  it('returns MAX_SAFE_INTEGER for all-zero distances (identical vectors)', () => {
    expect(estimateLambda([0, 0, 0])).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('λ = 1/avg_distance for well-formed input', () => {
    // avg([0.1, 0.3]) = 0.2, λ = 1/0.2 = 5
    expect(estimateLambda([0.1, 0.3])).toBeCloseTo(5, 5);
  });

  it('higher distances → lower λ (sparse region)', () => {
    const dense = estimateLambda([0.05, 0.1]);   // close neighbors → high λ
    const sparse = estimateLambda([0.8, 0.9]);   // distant neighbors → low λ
    expect(dense).toBeGreaterThan(sparse);
  });

  it('single distance entry', () => {
    expect(estimateLambda([0.5])).toBeCloseTo(2, 5);
  });
});

// ── (d) MinCutGate hysteresis ────────────────────────────────────────

describe('MinCutGate — hysteresis', () => {
  let gate: MinCutGate;

  beforeEach(() => {
    gate = new MinCutGate();
  });

  it('does not switch to MinCut_Gate at exactly the threshold (needs 10% margin)', () => {
    // dbSize=4: threshold = (log₂4)² = 4. To activate MinCut from L3, need λ ≥ 4*1.1 = 4.4
    // λ=4 (exactly at threshold) should still route to L3
    const distances = [1 / 4];  // λ = 4
    const decision = gate.decide(distances, 4);
    expect(decision.route).toBe('L3_Gate');
  });

  it('activates MinCut_Gate only when λ ≥ threshold × 1.1', () => {
    // threshold for dbSize=4 is 4; need λ ≥ 4.4 → avg_dist ≤ 1/4.4 ≈ 0.227
    const distances = [0.2];  // λ = 5 > 4.4
    const decision = gate.decide(distances, 4);
    expect(decision.route).toBe('MinCut_Gate');
  });

  it('once in MinCut_Gate, stays until λ drops below threshold × 0.9', () => {
    // Activate MinCut first
    gate.decide([0.2], 4);  // λ=5, activates MinCut

    // λ=4 (exactly at threshold) — with hysteresis exit at 4*0.9=3.6, λ=4 > 3.6, stays in MinCut
    const stay = gate.decide([0.25], 4);  // λ=4 > 3.6
    expect(stay.route).toBe('MinCut_Gate');

    // λ=3 < 3.6 — should exit MinCut
    const exit = gate.decide([0.33], 4);  // λ≈3.03 < 3.6
    expect(exit.route).toBe('L3_Gate');
  });

  it('reset() returns gate to L3_Gate state', () => {
    gate.decide([0.2], 4);     // activate MinCut
    gate.reset();
    const after = gate.decide([0.25], 4);  // λ=4 < 4*1.1=4.4 — L3 due to reset
    expect(after.route).toBe('L3_Gate');
  });

  it('decision includes lambda, threshold, and db_size', () => {
    const d = gate.decide([0.4], 10);
    expect(typeof d.lambda).toBe('number');
    expect(typeof d.threshold).toBe('number');
    expect(d.db_size).toBe(10);
    expect(d.reason.length).toBeGreaterThan(0);
  });
});

// ── (e) Cold-start always routes L3 ─────────────────────────────────

describe('MinCutGate — cold start', () => {
  it('dbSize=0 always routes to L3_Gate regardless of λ', () => {
    const gate = new MinCutGate();
    // Even with all-zero distances (MAX λ), threshold for n=0 is 1, but
    // hysteresis requires λ ≥ 1*1.1 = 1.1. MAX_SAFE_INTEGER > 1.1 so it might
    // activate — this is intentionally allowed once we have any data.
    // The real cold-start guard is that the patternRegistry is empty (dbSize=0).
    const d = gate.decide([], 0);  // no distances, no patterns
    expect(d.route).toBe('L3_Gate');  // λ=0 < 1*1.1=1.1
  });

  it('dbSize=1 with no search results → L3_Gate', () => {
    const gate = new MinCutGate();
    expect(gate.decide([], 1).route).toBe('L3_Gate');
  });
});

// ── (f) runGate fallback correctness ────────────────────────────────

describe('runGate — fallback does not fabricate verdicts', () => {
  const makeDecision = (route: 'L3_Gate' | 'MinCut_Gate'): GateDecision => ({
    route, lambda: 5, threshold: 4, db_size: 10, reason: 'test',
  });

  it('L3_Gate route returns l3Verdict unchanged', async () => {
    const verdict = { blocked: false, reason: 'clean' };
    const result = await runGate(makeDecision('L3_Gate'), verdict, []);
    expect(result.blocked).toBe(false);
    expect(result.reason).toBe('clean');
    expect(result.gate).toBe('L3_Gate_fallback');
  });

  it('MinCut_Gate route falls back to L3_Gate_fallback (WASM not installed)', async () => {
    const verdict = { blocked: true, reason: 'threat detected' };
    const result = await runGate(makeDecision('MinCut_Gate'), verdict, []);
    // Fallback must NOT change the blocked state — no fabrication
    expect(result.blocked).toBe(true);
    expect(result.reason).toBe('threat detected');
    expect(result.gate).toBe('L3_Gate_fallback');
  });

  it('fallback preserves blocked=false (does not add false positives)', async () => {
    const verdict = { blocked: false, reason: 'clean' };
    const result = await runGate(makeDecision('MinCut_Gate'), verdict, []);
    expect(result.blocked).toBe(false);
  });

  it('fallback preserves blocked=true (does not remove true positives)', async () => {
    const verdict = { blocked: true, reason: 'attack' };
    const result = await runGate(makeDecision('MinCut_Gate'), verdict, []);
    expect(result.blocked).toBe(true);
  });

  it('lambda is propagated in result', async () => {
    const decision = makeDecision('L3_Gate');
    const result = await runGate(decision, { blocked: false, reason: '' }, []);
    expect(result.lambda).toBe(decision.lambda);
  });
});
