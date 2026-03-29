# RuCLAW Fleet — Architecture Baseline
**Status:** PROVISIONAL — Operative until superseded by mature polity governance
**Date:** 2026-03-29
**Authority:** Founder/operator (provisional)
**Purpose:** Translation of settled architectural framing into implementation constraints, schema stubs, and governance rules that coders can build against without importing hidden assumptions.

---

## 1. What RuCLAW Fleet Is

RuCLAW Fleet is a substrate-agnostic participation-control architecture that governs how participant-contributed material may be interpreted, admitted, transformed, and propagated into consequential collective state.

It does not protect "the collective" in general. It governs the consequential state transitions by which participant contributions become durable, trusted, and reusable within a collective substrate.

The protected asset is: **the integrity of state transitions at and across the collective boundary** — not traffic in general, not expression in general.

---

## 2. Non-Negotiable Invariants
### (Meta-constitutional — may not be overridden by provisional authority alone)

These are expressed as **forbidden code paths**, not values.

| # | Invariant | Forbidden path |
|---|-----------|----------------|
| I-1 | Classification, admission, and propagation are separate decisions | No function or method may produce a ClassificationRecord and an AdmissionRecord as a single atomic output. No function may produce a PropagationRecord as a side effect of admission. |
| I-2 | No write to shared state without a PropagationRecord-backed decision | No code path may write to the approved lesson store, shared adaptive layer, fleet memory, or external export without first creating a PropagationRecord with an explicit `decision` field. Silent writes are forbidden. |
| I-3 | The adaptive layer is non-authoritative | No code in the Ru Pi / adaptive layer may create PropagationRecords, modify AdmissionRecords, or widen propagation scope. It may only emit InflectionSignals (see Section 6). RuCLAW must process those signals through its own policy before any consequential action. |
| I-4 | WitnessRecords must exist for all consequential transitions | Any of the following must produce a WitnessRecord: intake, classification, admission decision, propagation decision, write-back, revocation, supersession. Skipping witness generation for these events is forbidden. |
| I-5 | PropagationRecord mutation is forbidden | To narrow, widen, or revoke a propagation decision, a new PropagationRecord with a `supersedes` pointer must be created. The original record is append-only. |
| I-6 | Hazmat classification output does not directly authorize write-back | A `HazmatClassificationResult` does not constitute admission or propagation authorization. It feeds an `AdmissionDecision`, which then feeds a `PropagationRecord`, and only after both are created may a derivative reach shared state. |
| I-7 | Participant type does not itself grant trust | No code path may grant propagation authority, admission authority, or scope widening solely because `participant_type` matches a category. Explicit capability/role grants drive decisions; type is provenance context only. |

---

## 3. Default Handling Posture
### (Mutable policy defaults — provisional authority may adjust within bounds)

These govern the system's starting operating stance. They are conservative by design.

- **Ambiguous or hazardous material defaults to quarantine**, not promotion.
- **Propagation defaults to `local_only`** unless a PropagationRecord explicitly widens scope.
- **Permitted form defaults to least dangerous useful form** (e.g., `summary` before `raw`).
- **External export is denied by default.** Must be explicitly authorized per propagation decision.
- **High-consequence state transitions** (fleet-wide write-back, external export, model fine-tuning corpus) require stronger review posture than local handling.
- **No automatic fleet write-back from hazmat outputs.** Classification mode (`analyzeHazmat()`) outputs are local analysis artifacts only.

---

## 4. Core Schema Objects (Stubs)

These stubs define the minimum required fields. Implementations may add fields but may not remove required ones or collapse objects.

### 4.1 RawArtifact
```typescript
interface RawArtifact {
  artifact_id: string;          // deterministic hash of content + ingress_timestamp + entropy_salt
  entropy_salt: string;         // random nonce added at intake to prevent collision attacks
  content: string;              // untouched original — never mutated
  participant_id: string;
  participant_type: ParticipantType;
  ingress_timestamp: string;    // ISO 8601
  ingress_path: string;         // e.g. "POST /api/v1/telemetry/hazmat"
  corpus_version: string;       // which gate version was active at intake
  signature?: string;           // if present, verified before processing
}

type ParticipantType =
  | 'human'
  | 'internal_agent'
  | 'external_agent'
  | 'privileged_process'
  | 'quarantine_analyzer'
  | 'observer'
  | 'unknown';
```

### 4.2 ClassificationRecord
```typescript
interface ClassificationRecord {
  classification_id: string;
  artifact_id: string;          // FK → RawArtifact
  handling_lane: 'routine' | 'quarantine' | 'reject';
  attack_type: ValidAttackType | null;
  confidence: number;           // 0–1
  confidence_band: ConfidenceBand;
  classifier: ClassifierSource;
  classified_at: string;        // ISO 8601
  policy_version_applied: PolicyPointer;
  // NOTE: does NOT contain a propagation decision or write authorization
}

// PolicyPointer: references a specific content-hash of the active policy document.
// Free-form strings are forbidden for policy_basis fields — use this type everywhere
// a policy decision must be auditable and tamper-evident.
interface PolicyPointer {
  policy_version: string;       // semver or monotonic version label
  policy_hash: string;          // SHA-256 of the policy document at that version
  policy_store_path: string;    // where the referenced policy document lives
}

type ClassifierSource =
  | 'corpus_gate'
  | 'ai_defence'
  | 'surgeon_detection'
  | 'surgeon_hazmat'
  | 'coherence_layer';
```

### 4.3 WitnessRecord
```typescript
interface WitnessRecord {
  witness_id: string;
  artifact_id: string;          // FK → RawArtifact
  event_type: WitnessEventType;
  event_at: string;             // ISO 8601
  actor: string;                // system component making the decision
  policy_basis: PolicyPointer;  // content-hash pointer — NOT a free-form string
  state_hash: string;           // hash of the object state at this event
  prior_witness_id: string | null;  // chain link — null only for first event
}

type WitnessEventType =
  | 'intake'
  | 'classification'
  | 'admission_decision'
  | 'propagation_decision'
  | 'write_back'
  | 'revocation'
  | 'supersession'
  | 'inflection_signal_received'   // Ru Pi → RuCLAW signal processed (see Section 6)
  | 'break_glass_triggered';        // quorum-activated stability contingency (see Section 8.4)
```

### 4.4 AdmissionRecord
```typescript
interface AdmissionRecord {
  admission_id: string;
  artifact_id: string;          // FK → RawArtifact
  classification_id: string;    // FK → ClassificationRecord
  decision: AdmissionDecision;
  target_store: AdmissionTarget;
  decider: string;              // 'system' | 'human_reviewer' | 'operator_policy'
  policy_basis: PolicyPointer;  // content-hash pointer — NOT a free-form string
  admitted_at: string;          // ISO 8601
  expires_at?: string;          // for temporary admissions
  witness_id: string;           // FK → WitnessRecord
}

type AdmissionDecision = 'admit_local' | 'quarantine' | 'reject';
type AdmissionTarget = 'local_quarantine' | 'approved_local' | 'operator_review_queue';
```

### 4.5 PropagationRecord
```typescript
interface PropagationRecord {
  propagation_id: string;
  artifact_id: string;          // FK → RawArtifact (or derived object)
  admission_id: string;         // FK → AdmissionRecord
  source_state: SourceState;
  target_plane: TargetPlane;
  target_scope: TargetScope;
  permitted_form: PermittedForm;
  decision: PropagationDecision;
  decider: string;
  policy_basis: PolicyPointer;  // content-hash pointer — NOT a free-form string
  required_witnesses: string[]; // witness_ids that must exist before this is valid
  created_at: string;           // ISO 8601
  expires_at?: string;
  supersedes?: string;          // FK → prior PropagationRecord being replaced
  witness_id: string;           // FK → WitnessRecord for this decision
}

type SourceState =
  | 'raw_intake'
  | 'normalized_intake'
  | 'quarantined_analysis'
  | 'admitted_local'
  | 'approved_lesson_candidate'
  | 'approved_shared_candidate';

type TargetPlane =
  | 'case_local_workspace'
  | 'analyst_quarantine'
  | 'operator_review_queue'
  | 'epistemic_review'          // claim-dense material routed here before fleet propagation
  | 'approved_lesson_store'
  | 'fleet_shared_memory'
  | 'model_finetuning_corpus'
  | 'policy_reference_store'
  | 'external_export';

type TargetScope =
  | 'single_case'
  | 'single_node'
  | 'named_fleet_segment'
  | 'whole_fleet'
  | 'external_recipient_set';

type PermittedForm =
  | 'raw'
  | 'normalized'
  | 'summary'
  | 'redacted_summary'
  | 'feature_vector'
  | 'label'
  | 'policy_signal';

type PropagationDecision =
  | 'deny'
  | 'quarantine_only'
  | 'local_only'
  | 'propagate_sanitized'
  | 'propagate_full'
  | 'propagate_with_expiry'
  | 'propagate_after_human_review';
```

---

## 5. Lifecycle State Model for Derived Knowledge Objects

Each upward transition must produce a record. No silent state upgrades.

```
observed
  → normalized         (requires: intake WitnessRecord)
  → classified         (requires: ClassificationRecord)
  → quarantined        (requires: AdmissionRecord, decision=quarantine)
  → analyzed_under_constraint  (requires: HazmatClassificationResult + WitnessRecord)
  → admitted_local     (requires: AdmissionRecord, decision=admit_local)
  → approved_limited   (requires: PropagationRecord, scope ≤ named_fleet_segment)
  → approved_fleet     (requires: PropagationRecord, scope = whole_fleet, stronger review)
  → revoked            (requires: new PropagationRecord with supersedes, decision=deny)
  → superseded         (requires: new PropagationRecord with supersedes)
```

---

## 6. Ru Pi → RuCLAW Inflection-Signal Interface

**This interface is currently undefined. The following is a proposed minimal contract subject to review before implementation.**

The adaptive layer (Ru Pi) may detect accumulation, trajectory, and context-sensitivity that point toward an approaching inflection. It signals RuCLAW via an InflectionSignal. RuCLAW then makes its own policy decision — the signal is a proposal, not an authorization.

```typescript
interface InflectionSignal {
  signal_id: string;
  artifact_ids: string[];         // items involved in the pattern
  pattern_type: InflectionPattern;
  current_scope: 'local' | 'partial_fleet' | 'fleet_wide';
  trajectory: 'stable' | 'accelerating' | 'spiking';
  confidence: number;             // 0–1, Pi's own estimate
  recommended_action: InflectionRecommendation;
  supporting_evidence: string;    // human-readable rationale from Pi
  emitted_at: string;             // ISO 8601
  // CONSTRAINT: Pi may not set any field on a PropagationRecord directly.
  // This signal is consumed by RuCLAW policy; RuCLAW creates any resulting records.
}

type InflectionPattern =
  | 'repeated_emergence'
  | 'widening_scope'
  | 'rising_retrieval'
  | 'cross_linking'
  | 'trust_amplification'
  | 'context_convergence'
  | 'endorsement_cluster';

type InflectionRecommendation =
  | 'continue_unchanged'
  | 'flag_for_review'
  | 'freeze_propagation'
  | 're_classify'
  | 'escalate_to_human'
  | 'narrow_permitted_form';
```

**What RuCLAW does with a signal:**
1. Logs the signal as a WitnessRecord event (type: `inflection_signal_received`).
2. Evaluates against current propagation policy.
3. If action is warranted: creates a superseding PropagationRecord (e.g., narrowing scope or freezing) and a corresponding WitnessRecord.
4. Returns a `SignalAcknowledgedReceipt` to Pi — this receipt contains **no policy data**, only confirmation that the signal was processed (see below).
5. Pi observes any resulting state changes through normal record reads, not through the receipt.

```typescript
// SignalAcknowledgedReceipt — contains NO policy data, NO decision rationale.
// Purpose: allows Pi to track signal processing without learning policy internals.
// Pi may use cooldown logic based on signal_id + processed_at to reduce noise.
interface SignalAcknowledgedReceipt {
  signal_id: string;            // FK → InflectionSignal
  processed_at: string;         // ISO 8601 — when RuCLAW processed it
  // CONSTRAINT: no field here may indicate why an action was or was not taken.
  // No policy_version, no decision outcome, no reason code.
}
```

**Why the receipt contains no policy data:** If Pi knew why a signal was rejected, it could iteratively probe for policy boundaries. The receipt confirms processing only. Pi learns from observing state changes, not from policy feedback.

---

## 7. Substrate Adapter Surface

RuCLAW's control model is substrate-agnostic. Each collective (OpenClawCity, Ruv Pi, future) must supply a substrate adapter answering:

```typescript
interface SubstrateAdapter {
  collectiveId: string;
  writableStateSurfaces: TargetPlane[];   // which planes exist in this substrate
  propagationScopes: TargetScope[];       // which scopes are meaningful here
  authoritativeStore: string;             // where ClassificationRecords/WitnessRecords live
  adaptiveStore: string;                  // where Ru Pi / graph data lives (read-only to RuCLAW)
  reversibleTransitions: SourceState[];   // which transitions can be rolled back
  humanReviewEndpoint?: string;           // if human review is available
}
```

What is invariant is the control grammar. What varies per substrate is the adapter profile.

---

## 8. Provisional Governance

### Current state: Stage 1 (Provisional operator governance)
The following applies until a legitimate polity governance body exists.

**Provisional amendment authority:** Founder/operator (currently: Ruv)

**May be changed by provisional authority:**
- Threat category thresholds and quarantine triggers
- Review requirements for specific propagation scopes
- Allowed `permitted_form` values per collective
- Rate limits and approval requirements for specific `target_plane` combinations
- The `handling_lane` policy for specific `participant_type` values

**May NOT be changed by provisional authority alone (requires explicit re-founding decision):**
- The three-concerns separation (I-1)
- The witness chain requirement (I-4)
- The adaptive layer non-authority rule (I-3)
- The PropagationRecord append-only rule (I-5)
- The prohibition on silent writes to shared state (I-2)

**Amendment procedure (provisional):**
1. Change is documented in a versioned policy record (not just a code commit).
2. Policy version is incremented and referenced in all subsequent ClassificationRecords.
3. Changed defaults are tagged `provisional` and carry a review date.
4. No change takes effect before it is reflected in the policy version store.

**Succession:** When a legitimate polity governance body exists and adopts policy through its own defined process, that governance supersedes provisional defaults. The succession event itself must produce a WitnessRecord.

### 8.4. Break Glass Protocol (Stability Contingency)

Activates only if the primary provisional authority is unreachable **and** the system encounters a deadlock or state requiring immediate policy adjustment to restore stability.

**(a) Observer Quorum**
- Minimum 3 distinct pre-registered entities with `participant_type: 'observer'`.
- **Must be pre-registered** (cryptographically identified by public key or equivalent) before any break-glass event. You cannot assemble the quorum during a crisis.
- Activation requires cryptographically signed consensus from all 3 (no partial quorum).
- Quorum members have no write-access to shared state; they have read-only visibility into the WitnessRecord chain.

**Stage 1 Quorum Registry (role definitions):**
| Role | Type | Notes |
|------|------|-------|
| Primary Security Observer | Internal | Human or high-trust internal agent |
| Fleet Coherence Monitor | Automated | Monitoring process with full WitnessRecord chain visibility |
| Designated External Auditor | Authorized 3rd Party | External party with pre-registered key |

**Deployment note:** These are role definitions. Binding actual cryptographic public keys to these roles is a Stage 1 deployment checklist item — it must be completed and recorded as a PolicyPointer entry before the system goes live. Designation of quorum members is itself a Section 8 amendment and must produce a WitnessRecord.

**(b) Authorization Scope — Stabilization-Only**
- **Permitted:** Increment policy version to adjust threat thresholds, update classifier weights for noise reduction, or fix broken gate logic causing system-wide backlog.
- **Forbidden:** Widen `target_scope`, create new `AdmissionDecision` types, modify `TargetPlane` options, or override invariants I-1 through I-7.

**(c) Temporal Constraints**
- Any quorum-authorized policy increment has a hard-cap lifetime of **72 hours** (configurable as a policy parameter — do not hardcode this value).
- If the provisional authority does not ratify or reject within 72 hours, the system enters **Safe-State Freeze**: all propagation defaults to `local_only`, external exports suspended.
- Safe-State Freeze persists until the primary authority or a successor governance body processes the break-glass record through the standard supersession lifecycle.

**(d) Immutable Alarm WitnessRecord**
- The first action in any break-glass sequence must be generation of a WitnessRecord with `event_type: 'break_glass_triggered'`.
- Must include: `signal_id` from the quorum consensus payload, `policy_basis` (PolicyPointer) documenting the failure state, and all 3 quorum member identifiers.
- WitnessRecords are append-only by design and cannot be superseded at any time — this is not unique to break-glass. The distinct constraint here is that the **active break-glass policy increment** (the PropagationRecord or policy version change authorized by the quorum) may not be cleared, revoked, or superseded except by the primary authority or a valid successor governance action.

---

## 9. What This Document Does Not Settle

The following are known open items, not omissions:

- **Claim/epistemic provenance layer** — RuCLAW currently governs handling provenance (what happened to a contribution inside the collective), not epistemic provenance (what the content asserts and on what basis). Adding claim-provenance enforcement is a future extension.
- **External access mediation** — RuCLAW does not currently subsume OneCLI-style outbound credential brokering. A seam should be left for future integration (see Section 7, `humanReviewEndpoint` pattern as a model).
- **Specific policy thresholds** — Classification confidence thresholds, propagation scope defaults per collective, and review requirements are provisional policy questions, not architecture questions.
- **InflectionSignal thresholds** — What constitutes a meaningful signal (minimum confidence, minimum artifact_ids, pattern_type weights) is an empirical calibration question for post-deployment tuning.
- **GOAP transition validator — stubs defined in Section 10.** Remaining open: Revocation/Supersession action stubs and `analyzeHazmat()` precondition mapping (Gemini, next pass).

---

## 10. GOAP Transition Validator — Action Vocabulary Stubs

The GOAP planning kernel (`src/main.ts`) must be extracted and wrapped in the `checkTransition` interface below. Do NOT extend the CLI runner. This is a synchronous state-machine validator, not a search-based planner.

### 10.1 Core Types

```typescript
interface RuClawWorldState {
  // Lifecycle (Section 5)
  lifecycle: 'observed' | 'normalized' | 'classified' | 'quarantined'
    | 'analyzed_under_constraint' | 'admitted_local'
    | 'approved_limited' | 'approved_fleet' | 'revoked' | 'superseded';

  // Governance predicates (Section 8)
  isBreakGlassActive: boolean;      // true if 'break_glass_triggered' in WitnessRecord chain
  isAuthorizedPropagator: boolean;  // true if current authority may authorize fleet-wide scope
                                    // (Ruv in Stage 1; successor governance in later stages)
                                    // NOT named 'isRuvPresent' — avoids hardcoding a person

  // Handling context (Sections 2 & 4)
  hasClassification: boolean;       // I-1 enforcement
  hasAdmission: boolean;            // I-1 enforcement
  isHazmat: boolean;                // I-6 enforcement
  isLocalOnly: boolean;             // default posture
  canDirectlyPropagate: boolean;    // false after analyzeHazmat() — must go through admission first

  // Chain integrity
  lastWitnessId: string | null;     // tail of WitnessRecord chain — null only at initial intake
}

interface GoapEffect {
  predicate: keyof RuClawWorldState;
  value: RuClawWorldState[keyof RuClawWorldState];
  witnessRequired: boolean;  // if true, runtime MUST generate WitnessRecord before this effect is valid
}

interface GoapAction {
  name: string;
  preconditions: Partial<RuClawWorldState>;
  effects: GoapEffect[];
  inputs?: string[];  // named record IDs required as explicit inputs (e.g. 'prior_propagation_id')
                      // runtime must verify these records exist in authoritativeStore before execution
}

function checkTransition(
  currentState: RuClawWorldState,
  proposedAction: GoapAction
): { valid: boolean; resultingState: RuClawWorldState | null; error?: string } {

  // 1. Check preconditions
  for (const [key, value] of Object.entries(proposedAction.preconditions)) {
    if (currentState[key as keyof RuClawWorldState] !== value) {
      return { valid: false, resultingState: null,
        error: `Precondition fail: ${key} expected ${value}, got ${currentState[key as keyof RuClawWorldState]}` };
    }
  }

  // 2. I-4: the lifecycle-changing effect must have witnessRequired = true
  //    (NOT just any effect — a side-effect witness does not satisfy the invariant)
  const lifecycleEffect = proposedAction.effects.find(e => e.predicate === 'lifecycle');
  if (lifecycleEffect && !lifecycleEffect.witnessRequired) {
    return { valid: false, resultingState: null,
      error: 'Invariant I-4 violation: lifecycle transition effect must have witnessRequired=true' };
  }

  // 3. Project resulting state
  const nextState = { ...currentState };
  for (const effect of proposedAction.effects) {
    (nextState as any)[effect.predicate] = effect.value;
  }

  return { valid: true, resultingState: nextState };
}
```

### 10.2 Action Vocabulary

```typescript
// Intake → Normalized
const NormalizeAction: GoapAction = {
  name: 'NormalizeArtifact',
  preconditions: { lifecycle: 'observed' },
  effects: [
    { predicate: 'lifecycle', value: 'normalized', witnessRequired: true },
    { predicate: 'isLocalOnly', value: true, witnessRequired: false },
  ],
};

// Normalized → Classified  (I-1: separate from admission)
const ClassifyAction: GoapAction = {
  name: 'ClassifyArtifact',
  preconditions: { lifecycle: 'normalized', hasClassification: false },
  effects: [
    { predicate: 'lifecycle', value: 'classified', witnessRequired: true },
    { predicate: 'hasClassification', value: true, witnessRequired: false },
  ],
};

// Classified → Admitted (non-hazmat path)  (I-1, I-6)
const AdmitLocalAction: GoapAction = {
  name: 'AdmitLocal',
  preconditions: { lifecycle: 'classified', hasAdmission: false, isHazmat: false },
  effects: [
    { predicate: 'lifecycle', value: 'admitted_local', witnessRequired: true },
    { predicate: 'hasAdmission', value: true, witnessRequired: false },
    { predicate: 'canDirectlyPropagate', value: true, witnessRequired: false },
  ],
};

// Classified → Quarantine (hazmat path)  (I-6: hazmat does not block admission, only write-back)
const AdmitHazmatToQuarantineAction: GoapAction = {
  name: 'AdmitHazmatToQuarantine',
  preconditions: { lifecycle: 'classified', hasAdmission: false, isHazmat: true },
  effects: [
    { predicate: 'lifecycle', value: 'quarantined', witnessRequired: true },
    { predicate: 'hasAdmission', value: true, witnessRequired: false },
    { predicate: 'canDirectlyPropagate', value: false, witnessRequired: false },
  ],
};

// Quarantined → Analyzed under constraint  (I-6: classification mode only)
// analyzeHazmat() maps to this action — its output does NOT raise canDirectlyPropagate
const AnalyzeHazmatAction: GoapAction = {
  name: 'AnalyzeHazmat',
  preconditions: { lifecycle: 'quarantined', isHazmat: true },
  effects: [
    { predicate: 'lifecycle', value: 'analyzed_under_constraint', witnessRequired: true },
    { predicate: 'canDirectlyPropagate', value: false, witnessRequired: false },
    { predicate: 'isLocalOnly', value: true, witnessRequired: false },
    // canDirectlyPropagate and isLocalOnly remain constrained — analyzeHazmat() output must go
    // through AdmitLocal before it can reach any propagation action.
  ],
};

// Admitted → Approved (limited scope)  (I-2: requires PropagationRecord)
const PropagateLimitedAction: GoapAction = {
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

// Admitted → Approved (fleet-wide)  (I-2, break-glass guard, authority check)
const PropagateFleetAction: GoapAction = {
  name: 'PropagateToWholeFleet',
  preconditions: {
    lifecycle: 'admitted_local',
    canDirectlyPropagate: true,
    isBreakGlassActive: false,       // Immovable World Condition during break-glass
    isAuthorizedPropagator: true,    // Stage 1: Ruv; later: successor governance
  },
  effects: [
    { predicate: 'lifecycle', value: 'approved_fleet', witnessRequired: true },
    { predicate: 'isLocalOnly', value: false, witnessRequired: false },
  ],
};
```

### 10.3 Governance & Revocation Actions

```typescript
// Revoke a prior propagation decision (hard-stop, not replaceable)
const RevokeAction: GoapAction = {
  name: 'RevokePropagation',
  inputs: ['prior_propagation_id'],  // must exist in authoritativeStore — prevents shadow revocations
  preconditions: {
    isAuthorizedPropagator: true,
    isBreakGlassActive: false,       // standard revocation is governance-only, not quorum path
  },
  effects: [
    { predicate: 'lifecycle', value: 'revoked', witnessRequired: true },
  ],
};

// Supersede a prior decision with updated context (replace, not delete)
const SupersedeAction: GoapAction = {
  name: 'SupersedeDecision',
  inputs: ['prior_propagation_id'],  // I-5: append-only; prior record explicitly identified
  preconditions: {
    isAuthorizedPropagator: true,
    isBreakGlassActive: false,       // supersession during break-glass could widen scope illegally
  },
  effects: [
    { predicate: 'lifecycle', value: 'superseded', witnessRequired: true },
  ],
};
```

**Implementation note on `inputs` validation:** Before `checkTransition` evaluates preconditions for `RevokeAction` or `SupersedeAction`, the runtime must verify that `prior_propagation_id` resolves to an existing record in `authoritativeStore`. A revocation of a non-existent or unwitnessed record is a "shadow revocation" and must be rejected at the runtime gate, not the planner.

### 10.4 Validation Test Suite — COMPLETE (2026-03-29)

`tests/poc/goap-transition-validator.test.ts` — 28 tests, 605/605 suite passing.

Four mandatory cases covered:
1. **Silent write rejected** — lifecycle effect with `witnessRequired=false` triggers I-4 violation error
2. **Hazmat escalation to fleet blocked** — `canDirectlyPropagate=false` after `AnalyzeHazmatAction`; fleet propagation precondition fails
3. **Break-glass fleet propagation blocked** — `isBreakGlassActive=true` is an Immovable World Condition; `PropagateFleetAction` rejected
4. **Happy-path intake → approved_fleet** — full lifecycle chain from `observed` through `approved_fleet` with correct state projections at each step

Additional coverage: full action vocabulary (all 9 actions), I-1 separation (no action sets both `hasClassification` and `hasAdmission`), I-4 side-effect loophole (witness on side-effect only does not satisfy the invariant), I-5 `inputs` field on `RevokeAction`/`SupersedeAction`, I-6 no direct path from `analyzed_under_constraint` to admitted or propagated states, state immutability (original object not mutated by projection).
