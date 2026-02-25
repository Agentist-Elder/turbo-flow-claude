/**
 * Unit tests for applyConsensusVoting() — Phase 20 2-of-3 consensus gate.
 *
 * These tests cover the pure vote-counting logic without any DB, ONNX model,
 * or filesystem access. All threshold values are imported from min-cut-gate.ts
 * so tests stay in sync with production constants automatically.
 */
import { describe, it, expect } from 'vitest';
import {
  applyConsensusVoting,
  PARTITION_RATIO_THRESHOLD,
  SEMANTIC_COHERENCE_THRESHOLD,
  STAR_MINCUT_THRESHOLD,
} from '../../src/security/min-cut-gate.js';

// Convenience helpers — values that are just above / just below each threshold.
const RATIO_ATTACK  = PARTITION_RATIO_THRESHOLD + 0.5;   // e.g. 1.5
const RATIO_CLEAN   = PARTITION_RATIO_THRESHOLD - 0.01;  // e.g. 0.99
const LAMBDA_ATTACK = SEMANTIC_COHERENCE_THRESHOLD + 0.5; // e.g. 2.5
const LAMBDA_CLEAN  = SEMANTIC_COHERENCE_THRESHOLD - 0.5; // e.g. 1.5
const STAR_ATTACK   = STAR_MINCUT_THRESHOLD + 0.1;        // e.g. 0.5
const STAR_CLEAN    = STAR_MINCUT_THRESHOLD - 0.1;        // e.g. 0.3

const RATIO_RESULT_ATTACK = { ratio: RATIO_ATTACK, d_attack: 0.3, d_clean: 0.45 };
const RATIO_RESULT_CLEAN  = { ratio: RATIO_CLEAN,  d_attack: 0.45, d_clean: 0.44 };

describe('applyConsensusVoting — 3-discriminant mode (clean DB present)', () => {
  it('3/3 votes → shouldEscalate, not smokeOnly', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_ATTACK,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_ATTACK,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.smokeOnly).toBe(false);
    expect(r.votes).toHaveLength(3);
    expect(r.totalDiscriminants).toBe(3);
    expect(r.consensusThreshold).toBe(2);
  });

  it('2/3 votes (ratio + λ) → shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_ATTACK,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_CLEAN,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.votes).toHaveLength(2);
  });

  it('2/3 votes (ratio + star-λ) → shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_ATTACK,
      lambda: LAMBDA_CLEAN,
      starLambda: STAR_ATTACK,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.votes).toHaveLength(2);
  });

  it('2/3 votes (λ + star-λ, ratio below threshold) → shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_CLEAN,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_ATTACK,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.votes).toHaveLength(2);
  });

  it('1/3 votes (ratio only) → smokeOnly, not shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_ATTACK,
      lambda: LAMBDA_CLEAN,
      starLambda: STAR_CLEAN,
    });
    expect(r.shouldEscalate).toBe(false);
    expect(r.smokeOnly).toBe(true);
    expect(r.votes).toHaveLength(1);
  });

  it('1/3 votes (λ only) → smokeOnly', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_CLEAN,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_CLEAN,
    });
    expect(r.shouldEscalate).toBe(false);
    expect(r.smokeOnly).toBe(true);
  });

  it('1/3 votes (star-λ only) → smokeOnly', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_CLEAN,
      lambda: LAMBDA_CLEAN,
      starLambda: STAR_ATTACK,
    });
    expect(r.shouldEscalate).toBe(false);
    expect(r.smokeOnly).toBe(true);
  });

  it('0/3 votes → not shouldEscalate, not smokeOnly', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_CLEAN,
      lambda: LAMBDA_CLEAN,
      starLambda: STAR_CLEAN,
    });
    expect(r.shouldEscalate).toBe(false);
    expect(r.smokeOnly).toBe(false);
    expect(r.votes).toHaveLength(0);
  });

  it('vote strings contain the discriminant label and value', () => {
    const r = applyConsensusVoting({
      ratioResult: RATIO_RESULT_ATTACK,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_ATTACK,
    });
    expect(r.votes[0]).toMatch(/^ratio=/);
    expect(r.votes[1]).toMatch(/^λ=/);
    expect(r.votes[2]).toMatch(/^star-λ=/);
  });
});

describe('applyConsensusVoting — 2-discriminant fallback mode (clean DB absent)', () => {
  it('λ triggers → 1-of-2 → shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: null,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_CLEAN,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.totalDiscriminants).toBe(2);
    expect(r.consensusThreshold).toBe(1);
  });

  it('star-λ triggers → 1-of-2 → shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: null,
      lambda: LAMBDA_CLEAN,
      starLambda: STAR_ATTACK,
    });
    expect(r.shouldEscalate).toBe(true);
  });

  it('both trigger → 2-of-2 → shouldEscalate', () => {
    const r = applyConsensusVoting({
      ratioResult: null,
      lambda: LAMBDA_ATTACK,
      starLambda: STAR_ATTACK,
    });
    expect(r.shouldEscalate).toBe(true);
    expect(r.votes).toHaveLength(2);
  });

  it('neither triggers → not shouldEscalate, not smokeOnly', () => {
    const r = applyConsensusVoting({
      ratioResult: null,
      lambda: LAMBDA_CLEAN,
      starLambda: STAR_CLEAN,
    });
    expect(r.shouldEscalate).toBe(false);
    expect(r.smokeOnly).toBe(false);
  });
});
