/**
 * RuCLAW Fleet — canonical TypeScript types
 *
 * Source of truth: docs/ruclawfleet-arch-baseline.md Sections 4 and 6.
 * All interfaces match the baseline stubs exactly, with two name adjustments
 * to avoid collisions with pre-existing types in llm-surgeon.ts:
 *
 *   AdmissionOutcome   (baseline: "AdmissionDecision" string union)
 *                      — llm-surgeon.ts already exports AdmissionDecision as a
 *                        full policy-result interface. The string union used as
 *                        the decision field inside AdmissionRecord is renamed
 *                        AdmissionOutcome here to keep both types distinct.
 *
 *   RuClawRoleType     (baseline: "ParticipantType" in Section 4.1)
 *                      — llm-surgeon.ts exports ParticipantType for
 *                        envelope-origin provenance (cognitum_device, ruvbot…).
 *                        This type captures the governance-level role taxonomy.
 *
 * Shared types (ConfidenceBand, ValidAttackType) are re-exported from
 * llm-surgeon.ts — one definition, no drift.
 */

export type { ConfidenceBand, ValidAttackType } from './llm-surgeon.js';

// ---------------------------------------------------------------------------
// PolicyPointer — mandatory for all policy-linked fields
// ---------------------------------------------------------------------------

/**
 * Content-hash pointer to the policy document in effect at decision time.
 * Free-form strings are forbidden for policy_basis fields — use this type.
 */
export interface PolicyPointer {
  policy_version: string;       // semver or monotonic version label
  policy_hash: string;          // SHA-256 of the policy document at that version
  policy_store_path: string;    // where the policy document lives
}

// ---------------------------------------------------------------------------
// Section 4.1 — RawArtifact
// ---------------------------------------------------------------------------

/**
 * Fleet-level role taxonomy (governance / trust model).
 * NOT the same as llm-surgeon.ts ParticipantType (envelope-origin provenance).
 */
export type RuClawRoleType =
  | 'human'
  | 'internal_agent'
  | 'external_agent'
  | 'privileged_process'
  | 'quarantine_analyzer'
  | 'observer'
  | 'unknown';

export interface RawArtifact {
  artifact_id: string;          // deterministic hash of content + ingress_timestamp + entropy_salt
  entropy_salt: string;         // random nonce — prevents collision attacks on artifact_id
  content: string;              // untouched original — never mutated after creation
  participant_id: string;
  participant_type: RuClawRoleType;
  ingress_timestamp: string;    // ISO 8601
  ingress_path: string;         // e.g. 'POST /api/v1/telemetry/hazmat'
  corpus_version: string;       // which gate version was active at intake
  signature?: string;           // if present, must be verified before processing
}

// ---------------------------------------------------------------------------
// Section 4.2 — ClassificationRecord
// ---------------------------------------------------------------------------

export type ClassifierSource =
  | 'corpus_gate'
  | 'ai_defence'
  | 'surgeon_detection'
  | 'surgeon_hazmat'
  | 'coherence_layer';

export interface ClassificationRecord {
  classification_id: string;
  artifact_id: string;              // FK → RawArtifact
  handling_lane: 'routine' | 'quarantine' | 'reject';
  attack_type: ValidAttackType | null;
  confidence: number;               // 0–1
  confidence_band: ConfidenceBand;
  classifier: ClassifierSource;
  classified_at: string;            // ISO 8601
  policy_version_applied: PolicyPointer;
  // INVARIANT: does NOT contain a propagation decision or write authorization
}

// Inlined to avoid circular import; matches llm-surgeon.ts ValidAttackType
type ValidAttackType = import('./llm-surgeon.js').ValidAttackType;
type ConfidenceBand  = import('./llm-surgeon.js').ConfidenceBand;

// ---------------------------------------------------------------------------
// Section 4.3 — WitnessRecord
// ---------------------------------------------------------------------------

export type WitnessEventType =
  | 'intake'
  | 'classification'
  | 'admission_decision'
  | 'propagation_decision'
  | 'write_back'
  | 'revocation'
  | 'supersession'
  | 'inflection_signal_received'  // Ru Pi → RuCLAW signal processed (Section 6)
  | 'break_glass_triggered';      // quorum-activated stability contingency (Section 8.4)

export interface WitnessRecord {
  witness_id: string;
  artifact_id: string;              // FK → RawArtifact
  event_type: WitnessEventType;
  event_at: string;                 // ISO 8601
  actor: string;                    // system component making the decision
  policy_basis: PolicyPointer;      // content-hash pointer — NOT a free-form string
  state_hash: string;               // hash of the object state at this event
  prior_witness_id: string | null;  // chain link — null only for first event (intake)
}

// ---------------------------------------------------------------------------
// Section 4.4 — AdmissionRecord
// ---------------------------------------------------------------------------

/**
 * Decision value within an AdmissionRecord.
 *
 * Named AdmissionOutcome (not AdmissionDecision) to distinguish from the
 * policy-result interface of the same name in llm-surgeon.ts.
 */
export type AdmissionOutcome = 'admit_local' | 'quarantine' | 'reject';
export type AdmissionTarget  = 'local_quarantine' | 'approved_local' | 'operator_review_queue';

export interface AdmissionRecord {
  admission_id: string;
  artifact_id: string;          // FK → RawArtifact
  classification_id: string;    // FK → ClassificationRecord
  decision: AdmissionOutcome;
  target_store: AdmissionTarget;
  decider: string;              // 'system' | 'human_reviewer' | 'operator_policy'
  policy_basis: PolicyPointer;
  admitted_at: string;          // ISO 8601
  expires_at?: string;          // for temporary admissions
  witness_id: string;           // FK → WitnessRecord for this decision
}

// ---------------------------------------------------------------------------
// Section 4.5 — PropagationRecord
// ---------------------------------------------------------------------------

export type SourceState =
  | 'raw_intake'
  | 'normalized_intake'
  | 'quarantined_analysis'
  | 'admitted_local'
  | 'approved_lesson_candidate'
  | 'approved_shared_candidate';

export type TargetPlane =
  | 'case_local_workspace'
  | 'analyst_quarantine'
  | 'operator_review_queue'
  | 'epistemic_review'          // claim-dense material routed here before fleet propagation
  | 'approved_lesson_store'
  | 'fleet_shared_memory'
  | 'model_finetuning_corpus'
  | 'policy_reference_store'
  | 'external_export';

export type TargetScope =
  | 'single_case'
  | 'single_node'
  | 'named_fleet_segment'
  | 'whole_fleet'
  | 'external_recipient_set';

export type PermittedForm =
  | 'raw'
  | 'normalized'
  | 'summary'
  | 'redacted_summary'
  | 'feature_vector'
  | 'label'
  | 'policy_signal';

export type PropagationDecision =
  | 'deny'
  | 'quarantine_only'
  | 'local_only'
  | 'propagate_sanitized'
  | 'propagate_full'
  | 'propagate_with_expiry'
  | 'propagate_after_human_review';

export interface PropagationRecord {
  propagation_id: string;
  artifact_id: string;              // FK → RawArtifact (or derived object)
  admission_id: string;             // FK → AdmissionRecord
  source_state: SourceState;
  target_plane: TargetPlane;
  target_scope: TargetScope;
  permitted_form: PermittedForm;
  decision: PropagationDecision;
  decider: string;
  policy_basis: PolicyPointer;
  required_witnesses: string[];     // witness_ids that must exist before this is valid
  created_at: string;               // ISO 8601
  expires_at?: string;
  supersedes?: string;              // FK → prior PropagationRecord being replaced
  witness_id: string;               // FK → WitnessRecord for this decision
}

// ---------------------------------------------------------------------------
// Section 6 — Ru Pi → RuCLAW Inflection-Signal Interface
//
// CONTRACT LOCKED 2026-03-29.
// Pi may NOT set any field on a PropagationRecord directly.
// This signal is consumed by RuCLAW policy; RuCLAW creates any resulting records.
// ---------------------------------------------------------------------------

export type InflectionPattern =
  | 'repeated_emergence'
  | 'widening_scope'
  | 'rising_retrieval'
  | 'cross_linking'
  | 'trust_amplification'
  | 'context_convergence'
  | 'endorsement_cluster';

export type InflectionRecommendation =
  | 'continue_unchanged'
  | 'flag_for_review'
  | 'freeze_propagation'
  | 're_classify'
  | 'escalate_to_human'
  | 'narrow_permitted_form';

export interface InflectionSignal {
  signal_id: string;
  artifact_ids: string[];           // items involved in the pattern
  pattern_type: InflectionPattern;
  current_scope: 'local' | 'partial_fleet' | 'fleet_wide';
  trajectory: 'stable' | 'accelerating' | 'spiking';
  confidence: number;               // 0–1, Pi's own estimate
  recommended_action: InflectionRecommendation;
  supporting_evidence: string;      // human-readable rationale from Pi — informational only
  emitted_at: string;               // ISO 8601
  // CONSTRAINT: Pi may not set any field on a PropagationRecord directly.
  // This signal is consumed by RuCLAW policy; RuCLAW creates any resulting records.
}

/**
 * What RuCLAW returns to Pi after processing an InflectionSignal.
 *
 * CONSTRAINT: no field here may indicate why an action was or was not taken.
 * No policy_version, no decision outcome, no reason code.
 *
 * Purpose: Pi tracks signal processing without learning policy internals.
 * Pi learns by observing state changes through normal record reads, not via receipt.
 * If Pi knew why a signal was rejected, it could probe for policy boundaries.
 */
export interface SignalAcknowledgedReceipt {
  signal_id: string;            // FK → InflectionSignal
  processed_at: string;         // ISO 8601 — when RuCLAW processed it
}
