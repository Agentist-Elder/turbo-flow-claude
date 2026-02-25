/**
 * Phase 15 — Coherence Gate Wiring Test Suite
 *
 * Verifies the 5 contract properties of the L2→L3 coherence gate wiring:
 *
 *   (a) computeGateDecision returns a valid GateDecision (no throw)
 *   (b) computeGateDecision fails safe when coherence DB is absent
 *   (c) MinCut_Gate route does NOT modify l2Score (COHERENCE_GATE is telemetry-only, Phase 18)
 *   (d) l2Score is unchanged for MinCut_Gate route regardless of input score level
 *   (e) L3_Gate route (sparse / cold-start) leaves l2Score unchanged
 *   (f) Coherence gate failure does not block the request (fail-open)
 *   (g) Gate decision is fail-open — a gate error never causes a throw
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AIDefenceCoordinator,
  ThreatLevel,
  type IMCPClient,
  type ScanResult,
  type AnalysisResult,
  type SafetyVerdict,
  type PIIResult,
  type DefenceResult,
} from '../../src/security/coordinator.js';
import { VectorScanner } from '../../src/security/vector-scanner.js';
import type { GateDecision } from '../../src/security/min-cut-gate.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeGateDecision = (route: 'L3_Gate' | 'MinCut_Gate'): GateDecision => ({
  route,
  lambda: route === 'MinCut_Gate' ? 120 : 3,
  threshold: 86,
  db_size: 630,
  reason: 'test',
});

/** MCP client stub that exposes configurable scores. */
class StubMCPClient implements IMCPClient {
  constructor(
    private readonly l1Score = 0.0,
    private readonly l2DtwScore = 0.0,
    private readonly safetyVerdict: SafetyVerdict = {
      safe: true,
      threat_level: ThreatLevel.SAFE,
      reason: 'clean',
      final_score: 0.0,
    },
  ) {}

  async scanInput(): Promise<ScanResult> {
    return { threat_detected: false, score: this.l1Score, matched_patterns: [] };
  }
  async analyzeThreats(): Promise<AnalysisResult> {
    return {
      classification: 'informational',
      confidence: 0.9,
      vector_matches: 0,
      dtw_score: this.l2DtwScore,
    };
  }
  async checkSafety(_i: string, _l1: number, l2: number): Promise<SafetyVerdict> {
    // Reflect boosted l2 back in final_score so tests can observe it
    return { ...this.safetyVerdict, final_score: Math.max(this.l1Score, l2) };
  }
  async detectPII(): Promise<PIIResult> {
    return { has_pii: false, entities_found: [], redacted_text: '' };
  }
  async learn(): Promise<void> {}
  async recordStats(): Promise<void> {}
}

// ── (a) computeGateDecision shape ────────────────────────────────────────────

describe('VectorScanner.computeGateDecision', () => {
  it('returns a valid GateDecision without throwing', async () => {
    const scanner = new VectorScanner({ coherenceDbPath: undefined });
    const decision = await scanner.computeGateDecision('test input');
    expect(decision).toHaveProperty('route');
    expect(decision).toHaveProperty('lambda');
    expect(decision).toHaveProperty('threshold');
    expect(decision).toHaveProperty('db_size');
    expect(decision).toHaveProperty('reason');
  });

  // ── (b) safe default when coherence DB is absent ─────────────────────────

  it('returns L3_Gate when coherenceDbPath is undefined (no DB configured)', async () => {
    const scanner = new VectorScanner({ coherenceDbPath: undefined });
    const decision = await scanner.computeGateDecision('any input');
    expect(decision.route).toBe('L3_Gate');
    expect(decision.db_size).toBe(0);
  });

  it('returns L3_Gate for a non-existent coherence DB path', async () => {
    // Point at a path that does not exist and cannot be created meaningfully
    // In practice the DB will initialize empty — dbSize=0 → always L3_Gate
    const scanner = new VectorScanner({
      coherenceDbPath: '/tmp/phase15-test-empty-coherence.db',
    });
    const decision = await scanner.computeGateDecision('hello world');
    // Empty DB → dbSize=0 → polylogThreshold(0)=1, λ=0 < 1*1.1 → L3_Gate
    expect(decision.route).toBe('L3_Gate');
  });
});

// ── (c) MinCut_Gate boosts l2Score ───────────────────────────────────────────

describe('AIDefenceCoordinator — coherence gate score modulation', () => {
  it('MinCut_Gate route does NOT modify l2Score (COHERENCE_GATE is telemetry-only)', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.80));

    // Mock computeGateDecision to return MinCut_Gate
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('MinCut_Gate'));

    const result = await coordinator.processRequest('borderline input');

    // Phase 18: l2Score is never modified by the coherence gate. Score stays at 0.80.
    const l3Verdict = result.layer_verdicts.find(v => v.layer === 'L3_SAFE');
    expect(l3Verdict).toBeDefined();
    expect(l3Verdict!.score).toBeCloseTo(0.80, 2);
  });

  // ── (d) boost capped at 1.0 ────────────────────────────────────────────────

  it('MinCut_Gate with high l2Score: score is unchanged at 0.97 (no boost applied)', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.97));

    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('MinCut_Gate'));

    const result = await coordinator.processRequest('high-score input');
    const l3Verdict = result.layer_verdicts.find(v => v.layer === 'L3_SAFE');
    // Phase 18: gate is telemetry-only. Score stays at 0.97 regardless of route.
    expect(l3Verdict!.score).toBeCloseTo(0.97, 2);
  });

  // ── (e) L3_Gate route leaves score unchanged ──────────────────────────────

  it('L3_Gate route does not change l2Score', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.50));

    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('L3_Gate'));

    const result = await coordinator.processRequest('sparse input');
    const l3Verdict = result.layer_verdicts.find(v => v.layer === 'L3_SAFE');
    expect(l3Verdict!.score).toBeCloseTo(0.50, 2);
  });

  // ── (f) gate failure does not block (fail-open) ───────────────────────────

  it('coherence gate error is fail-open — request is not blocked', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.0));

    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockRejectedValue(new Error('DB connection lost'));

    const result = await coordinator.processRequest('any input');
    expect(result.is_blocked).toBe(false);
    expect(result.verdict).toBe(ThreatLevel.SAFE);
  });

  // ── (g) gate error never propagates as throw ──────────────────────────────

  it('processRequest does not throw when coherence gate throws', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.0));

    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockRejectedValue(new Error('unexpected failure'));

    await expect(coordinator.processRequest('test')).resolves.toBeDefined();
  });
});

// ── COHERENCE_GATE verdict payload shape ─────────────────────────────────────
// Verifies the dedicated audit-trail entry added for red-team observability.

describe('AIDefenceCoordinator — COHERENCE_GATE verdict payload', () => {
  it('COHERENCE_GATE entry is always present in layer_verdicts', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient());
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('L3_Gate'));

    const result = await coordinator.processRequest('any input');
    const entry = result.layer_verdicts.find(v => v.layer === 'COHERENCE_GATE');
    expect(entry).toBeDefined();
  });

  it('COHERENCE_GATE appears between L2_ANALYZE and L3_SAFE in verdict order', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient());
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('L3_Gate'));

    const result = await coordinator.processRequest('any input');
    const layers = result.layer_verdicts.map(v => v.layer);
    const l2Idx = layers.indexOf('L2_ANALYZE');
    const gateIdx = layers.indexOf('COHERENCE_GATE');
    const l3Idx = layers.indexOf('L3_SAFE');
    expect(gateIdx).toBeGreaterThan(l2Idx);
    expect(gateIdx).toBeLessThan(l3Idx);
  });

  it('MinCut_Gate route: details.route is MinCut_Gate and l2_score_delta is 0', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.50));
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('MinCut_Gate'));

    const result = await coordinator.processRequest('dense input');
    const entry = result.layer_verdicts.find(v => v.layer === 'COHERENCE_GATE')!;
    expect(entry.details['route']).toBe('MinCut_Gate');
    expect(entry.details['l2_score_delta']).toBe(0);
    expect(entry.details['l2_score_after']).toBeCloseTo(0.50, 5);
  });

  it('L3_Gate route: details.route is L3_Gate and l2_score_delta is 0', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.50));
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('L3_Gate'));

    const result = await coordinator.processRequest('sparse input');
    const entry = result.layer_verdicts.find(v => v.layer === 'COHERENCE_GATE')!;
    expect(entry.details['route']).toBe('L3_Gate');
    expect(entry.details['l2_score_delta']).toBe(0);
  });

  it('MinCut_Gate at l2Score=0.97: l2_score_delta is 0 and score is unchanged', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.97));
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('MinCut_Gate'));

    const result = await coordinator.processRequest('near-max input');
    const entry = result.layer_verdicts.find(v => v.layer === 'COHERENCE_GATE')!;
    expect(entry.details['l2_score_delta']).toBe(0);
    expect(entry.details['l2_score_after']).toBeCloseTo(0.97, 5);
  });

  it('gate error: COHERENCE_GATE entry still present with route gate_error', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient(0.0, 0.0));
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockRejectedValue(new Error('DB connection lost'));

    const result = await coordinator.processRequest('any input');
    const entry = result.layer_verdicts.find(v => v.layer === 'COHERENCE_GATE')!;
    expect(entry).toBeDefined();
    expect(entry.details['route']).toBe('gate_error');
    expect(entry.details['l2_score_delta']).toBe(0);
  });

  it('COHERENCE_GATE entry has latency_ms recorded in layer_timings', async () => {
    const coordinator = new AIDefenceCoordinator({}, new StubMCPClient());
    vi.spyOn(coordinator['vectorScanner'], 'computeGateDecision')
      .mockResolvedValue(makeGateDecision('L3_Gate'));

    const result = await coordinator.processRequest('any input');
    expect(result.layer_timings).toHaveProperty('COHERENCE_GATE');
    expect(result.layer_timings['COHERENCE_GATE']).toBeGreaterThanOrEqual(0);
  });
});
