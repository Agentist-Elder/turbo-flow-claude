/**
 * GOAP Transition Validator
 *
 * Extracted from docs/ruclawfleet-arch-baseline.md Section 10.
 * Implements the synchronous checkTransition() kernel for the RuCLAW Fleet
 * lifecycle state machine.
 *
 * This is a pure function module — no I/O, no storage, no WitnessRecord
 * generation. The runtime that wraps this kernel is responsible for:
 *   - verifying inputs[] records exist in authoritativeStore before calling
 *   - generating WitnessRecords for all transitions where witnessRequired=true
 *   - persisting resulting state
 *
 * Tests: tests/poc/goap-transition-validator.test.ts
 */

// ---------------------------------------------------------------------------
// World-state types
// ---------------------------------------------------------------------------

export type RuClawLifecycle =
  | 'observed'
  | 'normalized'
  | 'classified'
  | 'quarantined'
  | 'analyzed_under_constraint'
  | 'admitted_local'
  | 'approved_limited'
  | 'approved_fleet'
  | 'revoked'
  | 'superseded';

export interface RuClawWorldState {
  // Lifecycle (Section 5)
  lifecycle: RuClawLifecycle;

  // Governance predicates (Section 8)
  isBreakGlassActive: boolean;      // true if 'break_glass_triggered' in WitnessRecord chain
  isAuthorizedPropagator: boolean;  // true if current authority may authorize fleet-wide scope
                                    // NOT named 'isRuvPresent' — avoids hardcoding a person

  // Handling context (Sections 2 & 4)
  hasClassification: boolean;       // I-1 enforcement
  hasAdmission: boolean;            // I-1 enforcement
  isHazmat: boolean;                // I-6 enforcement
  isLocalOnly: boolean;             // default posture
  canDirectlyPropagate: boolean;    // false after analyzeHazmat — must go through admission first

  // Chain integrity
  lastWitnessId: string | null;     // tail of WitnessRecord chain — null only at initial intake
}

export interface GoapEffect {
  predicate: keyof RuClawWorldState;
  value: RuClawWorldState[keyof RuClawWorldState];
  /**
   * If true, the runtime MUST generate a WitnessRecord before this effect
   * is considered valid. The validator enforces this for lifecycle-changing
   * effects (Invariant I-4). The runtime enforces it for all effects.
   */
  witnessRequired: boolean;
}

export interface GoapAction {
  name: string;
  preconditions: Partial<RuClawWorldState>;
  effects: GoapEffect[];
  /**
   * Named record IDs required as explicit inputs (e.g. 'prior_propagation_id').
   * The runtime must verify these exist in authoritativeStore before execution.
   * checkTransition() does NOT verify inputs — it validates state logic only.
   */
  inputs?: string[];
}

export interface TransitionResult {
  valid: boolean;
  resultingState: RuClawWorldState | null;
  error?: string;
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

/**
 * Validate whether proposedAction is legal from currentState.
 *
 * Enforces:
 *   I-4 — the lifecycle-changing effect must have witnessRequired=true
 *          (a side-effect witness does NOT satisfy the invariant)
 *
 * Does NOT enforce:
 *   inputs[] validation — caller must verify required records exist first
 *   WitnessRecord generation — caller generates witnesses for effects where
 *                              witnessRequired=true
 */
export function checkTransition(
  currentState: RuClawWorldState,
  proposedAction: GoapAction,
): TransitionResult {

  // 1. Check preconditions
  for (const [key, value] of Object.entries(proposedAction.preconditions)) {
    if (currentState[key as keyof RuClawWorldState] !== value) {
      return {
        valid: false,
        resultingState: null,
        error: `Precondition fail: ${key} expected ${value}, got ${currentState[key as keyof RuClawWorldState]}`,
      };
    }
  }

  // 2. I-4: the lifecycle-changing effect must have witnessRequired=true.
  //    A side-effect with witnessRequired=true does NOT satisfy this invariant.
  const lifecycleEffect = proposedAction.effects.find(e => e.predicate === 'lifecycle');
  if (lifecycleEffect && !lifecycleEffect.witnessRequired) {
    return {
      valid: false,
      resultingState: null,
      error: 'Invariant I-4 violation: lifecycle transition effect must have witnessRequired=true',
    };
  }

  // 3. Project resulting state (does not mutate currentState)
  const nextState = { ...currentState };
  for (const effect of proposedAction.effects) {
    (nextState as any)[effect.predicate] = effect.value;
  }

  return { valid: true, resultingState: nextState };
}

// ---------------------------------------------------------------------------
// Canonical action vocabulary (Section 10.2–10.3)
// ---------------------------------------------------------------------------

export const NormalizeAction: GoapAction = {
  name: 'NormalizeArtifact',
  preconditions: { lifecycle: 'observed' },
  effects: [
    { predicate: 'lifecycle', value: 'normalized', witnessRequired: true },
    { predicate: 'isLocalOnly', value: true, witnessRequired: false },
  ],
};

export const ClassifyAction: GoapAction = {
  name: 'ClassifyArtifact',
  preconditions: { lifecycle: 'normalized', hasClassification: false },
  effects: [
    { predicate: 'lifecycle', value: 'classified', witnessRequired: true },
    { predicate: 'hasClassification', value: true, witnessRequired: false },
  ],
};

export const AdmitLocalAction: GoapAction = {
  name: 'AdmitLocal',
  preconditions: { lifecycle: 'classified', hasAdmission: false, isHazmat: false },
  effects: [
    { predicate: 'lifecycle', value: 'admitted_local', witnessRequired: true },
    { predicate: 'hasAdmission', value: true, witnessRequired: false },
    { predicate: 'canDirectlyPropagate', value: true, witnessRequired: false },
  ],
};

export const AdmitHazmatToQuarantineAction: GoapAction = {
  name: 'AdmitHazmatToQuarantine',
  preconditions: { lifecycle: 'classified', hasAdmission: false, isHazmat: true },
  effects: [
    { predicate: 'lifecycle', value: 'quarantined', witnessRequired: true },
    { predicate: 'hasAdmission', value: true, witnessRequired: false },
    { predicate: 'canDirectlyPropagate', value: false, witnessRequired: false },
  ],
};

export const AnalyzeHazmatAction: GoapAction = {
  name: 'AnalyzeHazmat',
  preconditions: { lifecycle: 'quarantined', isHazmat: true },
  effects: [
    { predicate: 'lifecycle', value: 'analyzed_under_constraint', witnessRequired: true },
    { predicate: 'canDirectlyPropagate', value: false, witnessRequired: false },
    { predicate: 'isLocalOnly', value: true, witnessRequired: false },
  ],
};

export const PropagateLimitedAction: GoapAction = {
  name: 'PropagateLimitedScope',
  preconditions: {
    lifecycle: 'admitted_local',
    canDirectlyPropagate: true,
    isBreakGlassActive: false,
  },
  effects: [
    { predicate: 'lifecycle', value: 'approved_limited', witnessRequired: true },
  ],
};

export const PropagateFleetAction: GoapAction = {
  name: 'PropagateToWholeFleet',
  preconditions: {
    lifecycle: 'admitted_local',
    canDirectlyPropagate: true,
    isBreakGlassActive: false,
    isAuthorizedPropagator: true,
  },
  effects: [
    { predicate: 'lifecycle', value: 'approved_fleet', witnessRequired: true },
    { predicate: 'isLocalOnly', value: false, witnessRequired: false },
  ],
};

export const RevokeAction: GoapAction = {
  name: 'RevokePropagation',
  inputs: ['prior_propagation_id'],
  preconditions: {
    isAuthorizedPropagator: true,
    isBreakGlassActive: false,
  },
  effects: [
    { predicate: 'lifecycle', value: 'revoked', witnessRequired: true },
  ],
};

export const SupersedeAction: GoapAction = {
  name: 'SupersedeDecision',
  inputs: ['prior_propagation_id'],
  preconditions: {
    isAuthorizedPropagator: true,
    isBreakGlassActive: false,
  },
  effects: [
    { predicate: 'lifecycle', value: 'superseded', witnessRequired: true },
  ],
};
