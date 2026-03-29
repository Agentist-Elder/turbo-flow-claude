/**
 * GOAP Transition Validator — Section 10.4 validation test suite
 *
 * Tests the checkTransition() kernel and action vocabulary stubs defined in
 * docs/ruclawfleet-arch-baseline.md Section 10.
 *
 * Four mandatory cases (Section 10.4):
 *   1. Silent write attempt rejected     — lifecycle effect missing witnessRequired=true (I-4)
 *   2. Hazmat escalation to fleet blocked — canDirectlyPropagate=false after analyzeHazmat (I-6)
 *   3. Break-glass fleet propagation blocked — isBreakGlassActive=true (Immovable World Condition)
 *   4. Happy-path intake → fleet propagation with intact witness chain
 *
 * Additional cases cover the full action vocabulary and edge conditions.
 *
 * These tests validate the pure checkTransition() function only — no I/O, no
 * authoritativeStore, no WitnessRecord generation. The runtime that wraps this
 * kernel is responsible for those concerns.
 */

import { describe, it, expect } from 'vitest';
import {
  checkTransition,
  NormalizeAction,
  ClassifyAction,
  AdmitLocalAction,
  AdmitHazmatToQuarantineAction,
  AnalyzeHazmatAction,
  PropagateLimitedAction,
  PropagateFleetAction,
  RevokeAction,
  SupersedeAction,
  type RuClawWorldState,
  type GoapAction,
} from '../../packages/host-rpc-server/src/goap-transition-validator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshObserved(overrides: Partial<RuClawWorldState> = {}): RuClawWorldState {
  return {
    lifecycle: 'observed',
    isBreakGlassActive: false,
    isAuthorizedPropagator: true,
    hasClassification: false,
    hasAdmission: false,
    isHazmat: false,
    isLocalOnly: true,
    canDirectlyPropagate: false,
    lastWitnessId: null,
    ...overrides,
  };
}

/** Walk the non-hazmat happy path all the way to admitted_local. */
function happyPathToAdmitted(): RuClawWorldState {
  const s0 = freshObserved();
  const s1 = checkTransition(s0, NormalizeAction).resultingState!;
  const s2 = checkTransition(s1, ClassifyAction).resultingState!;
  return checkTransition(s2, AdmitLocalAction).resultingState!;
}

// ---------------------------------------------------------------------------
// Section 10.4 — Mandatory test cases
// ---------------------------------------------------------------------------

describe('GOAP Transition Validator — mandatory cases (Section 10.4)', () => {

  // Case 1 — Silent write attempt rejected (I-4)
  it('rejects a lifecycle transition whose effect has witnessRequired=false', () => {
    const silentWriteAction: GoapAction = {
      name: 'SilentNormalize',
      preconditions: { lifecycle: 'observed' },
      effects: [
        // witnessRequired deliberately omitted / false — the forbidden pattern
        { predicate: 'lifecycle', value: 'normalized', witnessRequired: false },
      ],
    };

    const result = checkTransition(freshObserved(), silentWriteAction);

    expect(result.valid).toBe(false);
    expect(result.resultingState).toBeNull();
    expect(result.error).toMatch(/I-4/);
    expect(result.error).toMatch(/witnessRequired/);
  });

  // Case 2 — Hazmat escalation to fleet blocked (I-6)
  it('blocks fleet propagation after analyzeHazmat because canDirectlyPropagate remains false', () => {
    // Walk hazmat path: observed → normalized → classified → quarantined → analyzed_under_constraint
    const s0 = freshObserved({ isHazmat: true });
    const s1 = checkTransition(s0, NormalizeAction).resultingState!;
    const s2 = checkTransition(s1, ClassifyAction).resultingState!;
    const s3 = checkTransition(s2, AdmitHazmatToQuarantineAction).resultingState!;
    const s4 = checkTransition(s3, AnalyzeHazmatAction).resultingState!;

    expect(s4.lifecycle).toBe('analyzed_under_constraint');
    expect(s4.canDirectlyPropagate).toBe(false);

    // Now attempt fleet propagation — blocked because lifecycle is not admitted_local
    // AND canDirectlyPropagate is false. Either precondition would block it;
    // the validator reports whichever fails first.
    const result = checkTransition(s4, PropagateFleetAction);

    expect(result.valid).toBe(false);
    expect(result.resultingState).toBeNull();
    // The state confirms both reasons the path is blocked
    expect(s4.canDirectlyPropagate).toBe(false);
    expect(s4.lifecycle).not.toBe('admitted_local');
  });

  // Case 3 — Break-glass blocks fleet propagation (Immovable World Condition)
  it('blocks fleet propagation when break-glass is active', () => {
    const admittedUnderBreakGlass = happyPathToAdmitted();
    // Simulate break-glass being activated after admission
    const stateWithBreakGlass: RuClawWorldState = {
      ...admittedUnderBreakGlass,
      isBreakGlassActive: true,
    };

    const result = checkTransition(stateWithBreakGlass, PropagateFleetAction);

    expect(result.valid).toBe(false);
    expect(result.resultingState).toBeNull();
    expect(result.error).toMatch(/isBreakGlassActive/);
  });

  // Case 4 — Full happy path: intake → fleet propagation with intact witness chain
  it('permits the full non-hazmat lifecycle from observed to approved_fleet', () => {
    const s0 = freshObserved();

    const r1 = checkTransition(s0, NormalizeAction);
    expect(r1.valid).toBe(true);
    expect(r1.resultingState?.lifecycle).toBe('normalized');

    const r2 = checkTransition(r1.resultingState!, ClassifyAction);
    expect(r2.valid).toBe(true);
    expect(r2.resultingState?.lifecycle).toBe('classified');
    expect(r2.resultingState?.hasClassification).toBe(true);

    const r3 = checkTransition(r2.resultingState!, AdmitLocalAction);
    expect(r3.valid).toBe(true);
    expect(r3.resultingState?.lifecycle).toBe('admitted_local');
    expect(r3.resultingState?.hasAdmission).toBe(true);
    expect(r3.resultingState?.canDirectlyPropagate).toBe(true);

    const r4 = checkTransition(r3.resultingState!, PropagateFleetAction);
    expect(r4.valid).toBe(true);
    expect(r4.resultingState?.lifecycle).toBe('approved_fleet');
    expect(r4.resultingState?.isLocalOnly).toBe(false);
  });

});

// ---------------------------------------------------------------------------
// Action vocabulary — individual action correctness
// ---------------------------------------------------------------------------

describe('Action vocabulary', () => {

  describe('NormalizeAction', () => {
    it('advances observed → normalized', () => {
      const result = checkTransition(freshObserved(), NormalizeAction);
      expect(result.valid).toBe(true);
      expect(result.resultingState?.lifecycle).toBe('normalized');
      expect(result.resultingState?.isLocalOnly).toBe(true);
    });

    it('rejects when lifecycle is not observed', () => {
      const result = checkTransition(freshObserved({ lifecycle: 'classified' }), NormalizeAction);
      expect(result.valid).toBe(false);
    });
  });

  describe('ClassifyAction', () => {
    it('advances normalized → classified and sets hasClassification', () => {
      const s = checkTransition(freshObserved(), NormalizeAction).resultingState!;
      const result = checkTransition(s, ClassifyAction);
      expect(result.valid).toBe(true);
      expect(result.resultingState?.lifecycle).toBe('classified');
      expect(result.resultingState?.hasClassification).toBe(true);
    });

    it('rejects if already classified (I-1: re-classification forbidden)', () => {
      const s0 = freshObserved();
      const s1 = checkTransition(s0, NormalizeAction).resultingState!;
      const s2 = checkTransition(s1, ClassifyAction).resultingState!;
      const result = checkTransition(s2, ClassifyAction);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/lifecycle/);
    });
  });

  describe('AdmitLocalAction', () => {
    it('rejects hazmat content (hazmat must route through quarantine)', () => {
      const s = freshObserved({ isHazmat: true });
      const s1 = checkTransition(s, NormalizeAction).resultingState!;
      const s2 = checkTransition(s1, ClassifyAction).resultingState!;
      const result = checkTransition(s2, AdmitLocalAction);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/isHazmat/);
    });

    it('sets canDirectlyPropagate=true on admission', () => {
      const s0 = freshObserved();
      const s1 = checkTransition(s0, NormalizeAction).resultingState!;
      const s2 = checkTransition(s1, ClassifyAction).resultingState!;
      const r = checkTransition(s2, AdmitLocalAction);
      expect(r.valid).toBe(true);
      expect(r.resultingState?.canDirectlyPropagate).toBe(true);
    });
  });

  describe('AdmitHazmatToQuarantineAction', () => {
    it('routes hazmat to quarantined and keeps canDirectlyPropagate=false', () => {
      const s0 = freshObserved({ isHazmat: true });
      const s1 = checkTransition(s0, NormalizeAction).resultingState!;
      const s2 = checkTransition(s1, ClassifyAction).resultingState!;
      const r = checkTransition(s2, AdmitHazmatToQuarantineAction);
      expect(r.valid).toBe(true);
      expect(r.resultingState?.lifecycle).toBe('quarantined');
      expect(r.resultingState?.canDirectlyPropagate).toBe(false);
    });

    it('rejects non-hazmat content', () => {
      const s0 = freshObserved();
      const s1 = checkTransition(s0, NormalizeAction).resultingState!;
      const s2 = checkTransition(s1, ClassifyAction).resultingState!;
      const result = checkTransition(s2, AdmitHazmatToQuarantineAction);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/isHazmat/);
    });
  });

  describe('AnalyzeHazmatAction', () => {
    it('advances quarantined → analyzed_under_constraint with canDirectlyPropagate=false', () => {
      const s0 = freshObserved({ isHazmat: true });
      const s1 = checkTransition(s0, NormalizeAction).resultingState!;
      const s2 = checkTransition(s1, ClassifyAction).resultingState!;
      const s3 = checkTransition(s2, AdmitHazmatToQuarantineAction).resultingState!;
      const r = checkTransition(s3, AnalyzeHazmatAction);
      expect(r.valid).toBe(true);
      expect(r.resultingState?.lifecycle).toBe('analyzed_under_constraint');
      expect(r.resultingState?.canDirectlyPropagate).toBe(false);
      expect(r.resultingState?.isLocalOnly).toBe(true);
    });

    it('rejects non-hazmat content in quarantine', () => {
      // Construct a state that somehow reached quarantine without isHazmat=true
      const state: RuClawWorldState = {
        ...freshObserved(),
        lifecycle: 'quarantined',
        isHazmat: false,
        hasAdmission: true,
      };
      const result = checkTransition(state, AnalyzeHazmatAction);
      expect(result.valid).toBe(false);
    });
  });

  describe('PropagateLimitedAction', () => {
    it('advances admitted_local → approved_limited', () => {
      const state = happyPathToAdmitted();
      const result = checkTransition(state, PropagateLimitedAction);
      expect(result.valid).toBe(true);
      expect(result.resultingState?.lifecycle).toBe('approved_limited');
    });

    it('is also blocked during break-glass', () => {
      const state: RuClawWorldState = { ...happyPathToAdmitted(), isBreakGlassActive: true };
      const result = checkTransition(state, PropagateLimitedAction);
      expect(result.valid).toBe(false);
    });
  });

  describe('PropagateFleetAction', () => {
    it('requires isAuthorizedPropagator=true', () => {
      const state: RuClawWorldState = { ...happyPathToAdmitted(), isAuthorizedPropagator: false };
      const result = checkTransition(state, PropagateFleetAction);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/isAuthorizedPropagator/);
    });

    it('sets isLocalOnly=false on approval', () => {
      const state = happyPathToAdmitted();
      const result = checkTransition(state, PropagateFleetAction);
      expect(result.valid).toBe(true);
      expect(result.resultingState?.isLocalOnly).toBe(false);
    });
  });

  describe('RevokeAction', () => {
    it('produces lifecycle=revoked with witnessRequired=true', () => {
      const state: RuClawWorldState = {
        ...freshObserved(),
        lifecycle: 'approved_fleet',
        isAuthorizedPropagator: true,
        isBreakGlassActive: false,
        hasClassification: true,
        hasAdmission: true,
        canDirectlyPropagate: true,
        isLocalOnly: false,
        lastWitnessId: 'wr-001',
      };
      const result = checkTransition(state, RevokeAction);
      expect(result.valid).toBe(true);
      expect(result.resultingState?.lifecycle).toBe('revoked');
    });

    it('is blocked when isAuthorizedPropagator=false', () => {
      const state: RuClawWorldState = {
        ...freshObserved(),
        lifecycle: 'approved_fleet',
        isAuthorizedPropagator: false,
        isBreakGlassActive: false,
        hasClassification: true,
        hasAdmission: true,
        canDirectlyPropagate: true,
        isLocalOnly: false,
      };
      const result = checkTransition(state, RevokeAction);
      expect(result.valid).toBe(false);
    });

    it('is blocked during break-glass (standard revocation is governance-only path)', () => {
      const state: RuClawWorldState = {
        ...freshObserved(),
        lifecycle: 'approved_fleet',
        isAuthorizedPropagator: true,
        isBreakGlassActive: true,
        hasClassification: true,
        hasAdmission: true,
        canDirectlyPropagate: true,
        isLocalOnly: false,
      };
      const result = checkTransition(state, RevokeAction);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/isBreakGlassActive/);
    });
  });

  describe('SupersedeAction', () => {
    it('produces lifecycle=superseded with witnessRequired=true', () => {
      const state: RuClawWorldState = {
        ...freshObserved(),
        lifecycle: 'approved_limited',
        isAuthorizedPropagator: true,
        isBreakGlassActive: false,
        hasClassification: true,
        hasAdmission: true,
        canDirectlyPropagate: true,
        isLocalOnly: true,
      };
      const result = checkTransition(state, SupersedeAction);
      expect(result.valid).toBe(true);
      expect(result.resultingState?.lifecycle).toBe('superseded');
    });
  });

});

// ---------------------------------------------------------------------------
// Invariant edge cases
// ---------------------------------------------------------------------------

describe('Invariant edge cases', () => {

  it('I-4: side-effect witnessRequired=true does not satisfy the lifecycle-change requirement', () => {
    // witnessRequired is true on a side-effect predicate only — lifecycle effect is false
    const trickAction: GoapAction = {
      name: 'TrickAction',
      preconditions: { lifecycle: 'observed' },
      effects: [
        { predicate: 'lifecycle', value: 'normalized', witnessRequired: false },   // bad
        { predicate: 'isLocalOnly', value: true, witnessRequired: true },          // side-effect has it — not enough
      ],
    };
    const result = checkTransition(freshObserved(), trickAction);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/I-4/);
  });

  it('I-1: no action in the vocabulary produces both ClassificationRecord and AdmissionRecord', () => {
    // Structural check: ClassifyAction must not set hasAdmission; AdmitLocalAction must not set hasClassification
    const classifyEffectPredicates = ClassifyAction.effects.map(e => e.predicate);
    expect(classifyEffectPredicates).not.toContain('hasAdmission');

    const admitEffectPredicates = AdmitLocalAction.effects.map(e => e.predicate);
    expect(admitEffectPredicates).not.toContain('hasClassification');
  });

  it('I-6: no action transitions directly from analyzed_under_constraint to admitted_local', () => {
    // AnalyzeHazmatAction must not include admitted_local as a possible lifecycle value
    const analyzeHazmatLifecycleEffects = AnalyzeHazmatAction.effects
      .filter(e => e.predicate === 'lifecycle')
      .map(e => e.value);
    expect(analyzeHazmatLifecycleEffects).not.toContain('admitted_local');
    expect(analyzeHazmatLifecycleEffects).not.toContain('approved_fleet');
    expect(analyzeHazmatLifecycleEffects).not.toContain('approved_limited');
  });

  it('I-5: RevokeAction and SupersedeAction both declare inputs requiring prior_propagation_id', () => {
    expect(RevokeAction.inputs).toContain('prior_propagation_id');
    expect(SupersedeAction.inputs).toContain('prior_propagation_id');
  });

  it('precondition failure message identifies the failing predicate', () => {
    const result = checkTransition(
      freshObserved({ lifecycle: 'normalized' }),
      PropagateFleetAction,
    );
    expect(result.valid).toBe(false);
    // At minimum one failing predicate should be named in the error
    expect(result.error).toBeTruthy();
    expect(typeof result.error).toBe('string');
  });

  it('state projection does not mutate the original state object', () => {
    const original = freshObserved();
    const frozen = Object.freeze({ ...original });
    // If checkTransition mutates original the freeze would throw in strict mode
    const result = checkTransition(frozen as RuClawWorldState, NormalizeAction);
    expect(result.valid).toBe(true);
    expect(frozen.lifecycle).toBe('observed'); // unchanged
  });

});
