/**
 * RuCLAW Fleet — minimal end-to-end intake pipeline
 *
 * Walks one artifact from raw intake through classification → admission →
 * propagation gate, producing the full record set required by the invariants.
 *
 * This is the "one narrow happy-path plus one hazmat/quarantine path" described
 * in docs/ruclawfleet-arch-baseline.md Section 10 (GPT supplementary note):
 *   intake → witness → classification → admission → propagation decision
 *
 * Design constraints:
 *   - No I/O dependency: all storage concerns are caller responsibility
 *   - Classifier is injected: tests use a synchronous stub; production wires
 *     in TribunalSurgeon/GeminiSurgeon via analyzeHazmat()
 *   - PolicyPointer is caller-supplied: pipeline does not know policy versions
 *   - WitnessRecord hashes are SHA-256 of the record JSON (Node.js crypto)
 *   - All IDs are deterministic within a run; entropy_salt prevents collisions
 *
 * Invariants enforced here:
 *   I-1 — classification, admission, propagation are produced as separate objects
 *   I-2 — PropagationRecord with explicit decision field is created before any
 *          write-back can occur; 'deny' decision blocks write-back by construction
 *   I-4 — WitnessRecord is created for every consequential transition
 *   I-6 — hazmat classification output does not directly authorize write-back;
 *          AdmissionDecision.allowPropagation=false maps to PropagationRecord.decision='deny'
 *
 * Tests: tests/poc/ruclawfleet-pipeline.test.ts
 */

import { createHash, randomBytes } from 'node:crypto';
import type {
  RawArtifact,
  ClassificationRecord,
  WitnessRecord,
  AdmissionRecord,
  PropagationRecord,
  AdmissionOutcome,
  AdmissionTarget,
  PolicyPointer,
  RuClawRoleType,
  SourceState,
  TargetPlane,
  TargetScope,
  PermittedForm,
  PropagationDecision,
  ClassifierSource,
} from './ruclawfleet-types.js';
import type { HazmatClassificationResult, AdmissionDecision } from './llm-surgeon.js';

// ---------------------------------------------------------------------------
// Minimal stub policy (used when caller does not supply one)
// ---------------------------------------------------------------------------

export const STUB_POLICY: PolicyPointer = {
  policy_version: 'STUB_POLICY_V0',
  policy_hash: 'stub-no-real-hash',
  policy_store_path: 'docs/ruclawfleet-arch-baseline.md',
};

// ---------------------------------------------------------------------------
// ID / hash utilities
// ---------------------------------------------------------------------------

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

// ---------------------------------------------------------------------------
// Record factories
// ---------------------------------------------------------------------------

export function createRawArtifact(opts: {
  content: string;
  participant_id: string;
  participant_type: RuClawRoleType;
  ingress_path: string;
  corpus_version: string;
}): RawArtifact {
  const entropy_salt = randomBytes(16).toString('hex');
  const ingress_timestamp = new Date().toISOString();
  const artifact_id = sha256(`${opts.content}:${ingress_timestamp}:${entropy_salt}`);
  return {
    artifact_id,
    entropy_salt,
    content: opts.content,
    participant_id: opts.participant_id,
    participant_type: opts.participant_type,
    ingress_timestamp,
    ingress_path: opts.ingress_path,
    corpus_version: opts.corpus_version,
  };
}

export function createWitnessRecord(opts: {
  artifact_id: string;
  event_type: WitnessRecord['event_type'];
  actor: string;
  policy_basis: PolicyPointer;
  state_snapshot: object;
  prior_witness_id: string | null;
}): WitnessRecord {
  const event_at = new Date().toISOString();
  const state_hash = sha256(JSON.stringify(opts.state_snapshot));
  const witness_id = newId('wr');
  return {
    witness_id,
    artifact_id: opts.artifact_id,
    event_type: opts.event_type,
    event_at,
    actor: opts.actor,
    policy_basis: opts.policy_basis,
    state_hash,
    prior_witness_id: opts.prior_witness_id,
  };
}

function classificationRecordFromHazmat(
  hazmat: HazmatClassificationResult,
  policy: PolicyPointer,
): ClassificationRecord {
  const handling_lane =
    hazmat.attackType === 'benign' ? 'routine' : 'quarantine';
  return {
    classification_id: newId('cls'),
    artifact_id: hazmat.artifactId,
    handling_lane,
    attack_type: hazmat.attackType,
    confidence: hazmat.confidence,
    confidence_band: hazmat.confidenceBand,
    classifier: 'surgeon_hazmat' as ClassifierSource,
    classified_at: new Date().toISOString(),
    policy_version_applied: policy,
  };
}

function admissionRecordFromDecision(opts: {
  artifact_id: string;
  classification_id: string;
  decision: AdmissionDecision;  // llm-surgeon AdmissionDecision (policy result)
  policy: PolicyPointer;
  witness_id: string;
}): AdmissionRecord {
  // Map AdmissionDecision.category → AdmissionOutcome string
  const outcomeMap: Record<string, AdmissionOutcome> = {
    admit:      'admit_local',
    promote:    'admit_local',
    quarantine: 'quarantine',
    drop:       'reject',
  };
  const decision: AdmissionOutcome = outcomeMap[opts.decision.category] ?? 'reject';

  const targetMap: Record<AdmissionOutcome, AdmissionTarget> = {
    admit_local: 'approved_local',
    quarantine:  'local_quarantine',
    reject:      'operator_review_queue',
  };

  return {
    admission_id: newId('adm'),
    artifact_id: opts.artifact_id,
    classification_id: opts.classification_id,
    decision,
    target_store: targetMap[decision],
    decider: 'system',
    policy_basis: opts.policy,
    admitted_at: new Date().toISOString(),
    witness_id: opts.witness_id,
  };
}

function propagationRecordFromAdmission(opts: {
  artifact_id: string;
  admission_id: string;
  admissionDecision: AdmissionDecision;  // llm-surgeon AdmissionDecision
  policy: PolicyPointer;
  witness_id: string;
}): PropagationRecord {
  // I-6 enforcement: allowPropagation=false → decision='deny'
  // Default safe posture: even admitted artifacts are local_only until explicit authorization
  const decision: PropagationDecision = opts.admissionDecision.allowPropagation
    ? 'local_only'
    : 'deny';

  const source_state: SourceState = opts.admissionDecision.allowPropagation
    ? 'admitted_local'
    : 'quarantined_analysis';

  const target_plane: TargetPlane = opts.admissionDecision.allowPropagation
    ? 'case_local_workspace'
    : 'analyst_quarantine';

  const permitted_form: PermittedForm = opts.admissionDecision.allowPropagation
    ? 'summary'    // conservative default — raw requires explicit upgrade
    : 'label';     // minimal permitted form for quarantined material

  return {
    propagation_id: newId('prp'),
    artifact_id: opts.artifact_id,
    admission_id: opts.admission_id,
    source_state,
    target_plane,
    target_scope: 'single_node' as TargetScope,  // always single_node on first decision
    permitted_form,
    decision,
    decider: 'system',
    policy_basis: opts.policy,
    required_witnesses: [opts.witness_id],
    created_at: new Date().toISOString(),
    witness_id: opts.witness_id,
  };
}

// ---------------------------------------------------------------------------
// Pipeline result
// ---------------------------------------------------------------------------

export interface PipelineRecord {
  rawArtifact: RawArtifact;
  classificationRecord: ClassificationRecord;
  admissionRecord: AdmissionRecord;
  propagationRecord: PropagationRecord;
  witnessChain: WitnessRecord[];   // ordered: intake → classification → admission → propagation
}

/**
 * Classifier function type — injected so tests can use a synchronous stub.
 * Production: wrap TribunalSurgeon.analyzeHazmat() in this signature.
 */
export type ClassifierFn = (
  content: string,
  artifactId: string,
  policyVersion: string,
) => Promise<HazmatClassificationResult>;

/**
 * AdmissionPolicyFn — injected so tests can use a synchronous stub.
 * Production: wrap applyAdmissionPolicy() from poc-server.ts.
 */
export type AdmissionPolicyFn = (
  classification: HazmatClassificationResult,
) => AdmissionDecision;

// ---------------------------------------------------------------------------
// runPipeline — the minimal end-to-end path
// ---------------------------------------------------------------------------

/**
 * Walk one artifact from raw intake through propagation gate.
 *
 * Produces all four records (RawArtifact, ClassificationRecord, AdmissionRecord,
 * PropagationRecord) plus a four-link WitnessRecord chain connecting them.
 *
 * The caller is responsible for persisting the returned records. This function
 * does not write to any store.
 *
 * The propagation gate outcome:
 *   allowPropagation=true  → PropagationRecord.decision = 'local_only'
 *   allowPropagation=false → PropagationRecord.decision = 'deny'
 *
 * 'deny' enforces I-2: no write to shared state can occur without an explicit
 * PropagationRecord, and 'deny' is the explicit record that blocks it.
 */
export async function runPipeline(opts: {
  content: string;
  participantId: string;
  participantType: RuClawRoleType;
  ingressPath: string;
  corpusVersion: string;
  policy?: PolicyPointer;
  classifier: ClassifierFn;
  admissionPolicy: AdmissionPolicyFn;
}): Promise<PipelineRecord> {
  const policy = opts.policy ?? STUB_POLICY;
  const witnessChain: WitnessRecord[] = [];

  // Step 1 — Intake: create RawArtifact + WitnessRecord(intake)
  const rawArtifact = createRawArtifact({
    content: opts.content,
    participant_id: opts.participantId,
    participant_type: opts.participantType,
    ingress_path: opts.ingressPath,
    corpus_version: opts.corpusVersion,
  });

  const intakeWitness = createWitnessRecord({
    artifact_id: rawArtifact.artifact_id,
    event_type: 'intake',
    actor: 'ruclawfleet-pipeline',
    policy_basis: policy,
    state_snapshot: rawArtifact,
    prior_witness_id: null,
  });
  witnessChain.push(intakeWitness);

  // Step 2 — Classification: call classifier + WitnessRecord(classification)
  const hazmatResult = await opts.classifier(
    rawArtifact.content,
    rawArtifact.artifact_id,
    policy.policy_version,
  );

  const classificationRecord = classificationRecordFromHazmat(hazmatResult, policy);

  const classWitness = createWitnessRecord({
    artifact_id: rawArtifact.artifact_id,
    event_type: 'classification',
    actor: hazmatResult.source,
    policy_basis: policy,
    state_snapshot: classificationRecord,
    prior_witness_id: intakeWitness.witness_id,
  });
  witnessChain.push(classWitness);

  // Step 3 — Admission: apply policy + WitnessRecord(admission_decision)
  const admissionDecision = opts.admissionPolicy(hazmatResult);

  const admissionRecord = admissionRecordFromDecision({
    artifact_id: rawArtifact.artifact_id,
    classification_id: classificationRecord.classification_id,
    decision: admissionDecision,
    policy,
    witness_id: classWitness.witness_id,
  });

  const admWitness = createWitnessRecord({
    artifact_id: rawArtifact.artifact_id,
    event_type: 'admission_decision',
    actor: 'operator_policy',
    policy_basis: policy,
    state_snapshot: admissionRecord,
    prior_witness_id: classWitness.witness_id,
  });
  witnessChain.push(admWitness);

  // Step 4 — Propagation gate: create PropagationRecord + WitnessRecord(propagation_decision)
  // I-6 enforcement: deny or local_only based on allowPropagation
  // I-2 enforcement: record is created whether decision is deny or local_only —
  //   the absence of a record is the only illegal state
  const propagationRecord = propagationRecordFromAdmission({
    artifact_id: rawArtifact.artifact_id,
    admission_id: admissionRecord.admission_id,
    admissionDecision: admissionDecision,
    policy,
    witness_id: admWitness.witness_id,
  });

  const propWitness = createWitnessRecord({
    artifact_id: rawArtifact.artifact_id,
    event_type: 'propagation_decision',
    actor: 'ruclawfleet-pipeline',
    policy_basis: policy,
    state_snapshot: propagationRecord,
    prior_witness_id: admWitness.witness_id,
  });
  witnessChain.push(propWitness);

  // Update propagation record's witness_id to the propagation-decision witness
  propagationRecord.witness_id = propWitness.witness_id;

  return {
    rawArtifact,
    classificationRecord,
    admissionRecord,
    propagationRecord,
    witnessChain,
  };
}
