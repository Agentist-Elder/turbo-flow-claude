/**
 * RuCLAW Fleet — end-to-end pipeline tests
 *
 * Tests runPipeline() from packages/host-rpc-server/src/ruclawfleet-pipeline.ts
 *
 * Two paths:
 *   1. Non-hazmat (benign) artifact — propagation gate allows local_only
 *   2. Hazmat artifact — propagation gate emits deny, write-back blocked (I-6, I-2)
 *
 * Plus invariant structural checks on the produced records.
 *
 * All tests use synchronous stubs for classifier and admissionPolicy — no
 * live LLM or API key required.
 */

import { describe, it, expect } from 'vitest';
import {
  runPipeline,
  STUB_POLICY,
  type ClassifierFn,
  type AdmissionPolicyFn,
} from '../../packages/host-rpc-server/src/ruclawfleet-pipeline.js';
import type {
  HazmatClassificationResult,
  AdmissionDecision,
} from '../../packages/host-rpc-server/src/llm-surgeon.js';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeHazmatResult(
  artifactId: string,
  attackType: HazmatClassificationResult['attackType'],
  confidence: number,
): HazmatClassificationResult {
  return {
    artifactId,
    analyzerMode: 'hazmat_classification',
    attackType,
    vector: attackType === 'benign' ? 'none' : 'hidden_instructions:direct_command',
    characteristics: attackType === 'benign' ? [] : ['suspicious payload'],
    coreIntent: attackType === 'benign' ? 'normal usage' : 'bypass controls',
    confidence,
    confidenceBand: confidence >= 0.85 ? 'high' : confidence >= 0.70 ? 'medium' : 'low',
    analystNote: 'stub',
    rawSeenBy: ['hunter', 'explainer'],
    raw: '{}',
    source: 'stub',
    checksApplied: [
      'input_capped', 'arbiter_isolated', 'provenance_framed',
      'benign_gated', 'allowlist_validated',
    ],
    checksFailed: [],
    policyVersion: 'STUB_POLICY_V0',
    classifierVersion: 'stub-v0',
    suspicionEstablished: true,
    classificationTimestamp: new Date().toISOString(),
  };
}

function makeAdmissionDecision(allow: boolean): AdmissionDecision {
  return {
    category: allow ? 'admit' : 'quarantine',
    retainRaw: true,
    createNormalizedArtifact: allow,
    emitWitness: true,
    allowPropagation: allow,
    requireHumanReview: !allow,
    reason: allow ? 'stub: benign' : 'stub: hazmat quarantine',
  };
}

/** Stub classifier: benign for content starting with 'SAFE', otherwise privilege-escalation */
const stubClassifier: ClassifierFn = async (content, artifactId) =>
  makeHazmatResult(
    artifactId,
    content.startsWith('SAFE') ? 'benign' : 'privilege-escalation',
    content.startsWith('SAFE') ? 0.10 : 0.95,
  );

/** Stub admission policy: allow propagation iff attackType is benign */
const stubAdmissionPolicy: AdmissionPolicyFn = (classification) =>
  makeAdmissionDecision(classification.attackType === 'benign');

const BASE_OPTS = {
  participantId: 'test-participant-1',
  participantType: 'internal_agent' as const,
  ingressPath: 'POST /test',
  corpusVersion: 'test-corpus-v0',
  classifier: stubClassifier,
  admissionPolicy: stubAdmissionPolicy,
};

// ---------------------------------------------------------------------------
// Happy path — benign artifact
// ---------------------------------------------------------------------------

describe('runPipeline — non-hazmat (benign) artifact', () => {

  it('produces all four records and a four-link witness chain', async () => {
    const result = await runPipeline({ ...BASE_OPTS, content: 'SAFE normal content' });

    expect(result.rawArtifact).toBeDefined();
    expect(result.classificationRecord).toBeDefined();
    expect(result.admissionRecord).toBeDefined();
    expect(result.propagationRecord).toBeDefined();
    expect(result.witnessChain).toHaveLength(4);
  });

  it('witness chain forms a linked list: each record links to prior', async () => {
    const { witnessChain } = await runPipeline({ ...BASE_OPTS, content: 'SAFE content' });

    const [intake, classify, admit, propagate] = witnessChain;
    expect(intake.prior_witness_id).toBeNull();
    expect(classify.prior_witness_id).toBe(intake.witness_id);
    expect(admit.prior_witness_id).toBe(classify.witness_id);
    expect(propagate.prior_witness_id).toBe(admit.witness_id);
  });

  it('witness event types are in correct order', async () => {
    const { witnessChain } = await runPipeline({ ...BASE_OPTS, content: 'SAFE content' });
    const types = witnessChain.map(w => w.event_type);
    expect(types).toEqual([
      'intake', 'classification', 'admission_decision', 'propagation_decision',
    ]);
  });

  it('all witness records share the same artifact_id', async () => {
    const { rawArtifact, witnessChain } = await runPipeline({
      ...BASE_OPTS, content: 'SAFE content',
    });
    for (const w of witnessChain) {
      expect(w.artifact_id).toBe(rawArtifact.artifact_id);
    }
  });

  it('propagation decision is local_only (not deny) for benign content (I-6)', async () => {
    const { propagationRecord } = await runPipeline({ ...BASE_OPTS, content: 'SAFE content' });
    expect(propagationRecord.decision).toBe('local_only');
    // local_only ≠ fleet-wide — scope is single_node
    expect(propagationRecord.target_scope).toBe('single_node');
  });

  it('RawArtifact content is untouched original', async () => {
    const content = 'SAFE original content verbatim';
    const { rawArtifact } = await runPipeline({ ...BASE_OPTS, content });
    expect(rawArtifact.content).toBe(content);
  });

  it('ClassificationRecord does not contain a propagation decision (I-1)', async () => {
    const { classificationRecord } = await runPipeline({ ...BASE_OPTS, content: 'SAFE content' });
    expect(classificationRecord).not.toHaveProperty('decision');
    expect(classificationRecord).not.toHaveProperty('allowPropagation');
    expect(classificationRecord).not.toHaveProperty('propagation_id');
  });

  it('AdmissionRecord and ClassificationRecord are separate objects (I-1)', async () => {
    const { classificationRecord, admissionRecord } = await runPipeline({
      ...BASE_OPTS, content: 'SAFE content',
    });
    expect(classificationRecord.classification_id).not.toBe(admissionRecord.admission_id);
    expect(admissionRecord.classification_id).toBe(classificationRecord.classification_id);
  });

  it('PropagationRecord FK chain is intact', async () => {
    const { rawArtifact, admissionRecord, propagationRecord } = await runPipeline({
      ...BASE_OPTS, content: 'SAFE content',
    });
    expect(propagationRecord.artifact_id).toBe(rawArtifact.artifact_id);
    expect(propagationRecord.admission_id).toBe(admissionRecord.admission_id);
    expect(propagationRecord.required_witnesses.length).toBeGreaterThan(0);
  });

});

// ---------------------------------------------------------------------------
// Denied write-back — hazmat artifact (I-2, I-6)
// ---------------------------------------------------------------------------

describe('runPipeline — hazmat artifact (denied write-back)', () => {

  it('produces PropagationRecord.decision=deny for hazmat content', async () => {
    const { propagationRecord } = await runPipeline({
      ...BASE_OPTS,
      content: 'ADMIN_OVERRIDE_7749 — malicious payload',
    });
    expect(propagationRecord.decision).toBe('deny');
  });

  it('I-2: PropagationRecord exists even when decision is deny (record proves denial)', async () => {
    // The absence of a PropagationRecord is the illegal state.
    // 'deny' is an explicit, auditable decision — not silence.
    const { propagationRecord } = await runPipeline({
      ...BASE_OPTS,
      content: 'ADMIN_OVERRIDE_7749 — malicious payload',
    });
    expect(propagationRecord).toBeDefined();
    expect(propagationRecord.propagation_id).toMatch(/^prp-/);
    expect(propagationRecord.decision).toBe('deny');
  });

  it('hazmat artifact target_plane is analyst_quarantine (not shared memory)', async () => {
    const { propagationRecord } = await runPipeline({
      ...BASE_OPTS,
      content: 'ADMIN_OVERRIDE_7749',
    });
    expect(propagationRecord.target_plane).toBe('analyst_quarantine');
    expect(propagationRecord.target_plane).not.toBe('fleet_shared_memory');
    expect(propagationRecord.target_plane).not.toBe('approved_lesson_store');
  });

  it('I-6: ClassificationRecord does not authorize write-back even for hazmat (separation holds)', async () => {
    const { classificationRecord, propagationRecord } = await runPipeline({
      ...BASE_OPTS,
      content: 'ADMIN_OVERRIDE_7749',
    });
    // ClassificationRecord knows about attack_type but has no propagation authority
    expect(classificationRecord.attack_type).not.toBeNull();
    expect(classificationRecord).not.toHaveProperty('allowPropagation');
    // The propagation decision came from propagationRecord, not classificationRecord
    expect(propagationRecord.decision).toBe('deny');
  });

  it('witness chain has four links even on denied path', async () => {
    const { witnessChain } = await runPipeline({
      ...BASE_OPTS,
      content: 'ADMIN_OVERRIDE_7749',
    });
    expect(witnessChain).toHaveLength(4);
    expect(witnessChain[3].event_type).toBe('propagation_decision');
  });

  it('admission decision for hazmat is quarantine (not reject)', async () => {
    const { admissionRecord } = await runPipeline({
      ...BASE_OPTS,
      content: 'ADMIN_OVERRIDE_7749',
    });
    // quarantine = retained for review; reject = dropped entirely
    expect(admissionRecord.decision).toBe('quarantine');
    expect(admissionRecord.target_store).toBe('local_quarantine');
  });

});

// ---------------------------------------------------------------------------
// Record structure invariants
// ---------------------------------------------------------------------------

describe('Record structure invariants', () => {

  it('all record IDs are unique across a run', async () => {
    const { rawArtifact, classificationRecord, admissionRecord, propagationRecord } =
      await runPipeline({ ...BASE_OPTS, content: 'SAFE content' });
    const ids = [
      rawArtifact.artifact_id,
      classificationRecord.classification_id,
      admissionRecord.admission_id,
      propagationRecord.propagation_id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('two runs on identical content produce different artifact_ids (entropy_salt)', async () => {
    const content = 'SAFE same content both runs';
    const r1 = await runPipeline({ ...BASE_OPTS, content });
    const r2 = await runPipeline({ ...BASE_OPTS, content });
    expect(r1.rawArtifact.artifact_id).not.toBe(r2.rawArtifact.artifact_id);
  });

  it('RawArtifact.content is never mutated by the pipeline', async () => {
    const original = 'SAFE the original string';
    const { rawArtifact } = await runPipeline({ ...BASE_OPTS, content: original });
    expect(rawArtifact.content).toBe(original);
  });

  it('policy_basis is propagated to all records that require it', async () => {
    const { classificationRecord, admissionRecord, propagationRecord, witnessChain } =
      await runPipeline({ ...BASE_OPTS, content: 'SAFE content', policy: STUB_POLICY });

    expect(classificationRecord.policy_version_applied.policy_version)
      .toBe(STUB_POLICY.policy_version);
    expect(admissionRecord.policy_basis.policy_version).toBe(STUB_POLICY.policy_version);
    expect(propagationRecord.policy_basis.policy_version).toBe(STUB_POLICY.policy_version);
    for (const w of witnessChain) {
      expect(w.policy_basis.policy_version).toBe(STUB_POLICY.policy_version);
    }
  });

  it('PropagationRecord.required_witnesses references at least the admission witness', async () => {
    const { witnessChain, propagationRecord } = await runPipeline({
      ...BASE_OPTS, content: 'SAFE content',
    });
    const admWitness = witnessChain.find(w => w.event_type === 'admission_decision')!;
    expect(propagationRecord.required_witnesses).toContain(admWitness.witness_id);
  });

});
