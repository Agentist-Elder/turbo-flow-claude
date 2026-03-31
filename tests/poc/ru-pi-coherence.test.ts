/**
 * Ru Pi Coherence Layer — unit tests
 *
 * Covers:
 *   buildSheafGraph()        — graph construction from WitnessRecord / PropagationRecord
 *   classifyIntent()         — intent classification by target_plane and permitted_form
 *   mapEnergyToPrivilege()   — boundary value analysis for privilege thresholds
 *   analyzeContribution()    — RuPiSignal shape with mocked CohomologyEngine (WASM-STUB)
 *   applyAdmissionPolicy()   — backward-compatible extension with RuPiSignal
 *
 * Tests run without WASM — CohomologyEngine is replaced by a synchronous stub.
 * All WASM-STUB usages are marked with // WASM-STUB.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSheafGraph,
  classifyIntent,
  mapEnergyToPrivilege,
  RuPiCoherenceEngine,
  RuPiNotInitializedError,
  type RuPiSignal,
  type CohomologyEngineInterface,
  type SheafGraph,
} from '../../packages/host-rpc-server/src/ru-pi-coherence.js';
import { applyAdmissionPolicy } from '../../scripts/poc/poc-server.js';
import {
  HAZMAT_CHECKS,
  type HazmatClassificationResult,
} from '../../packages/host-rpc-server/src/llm-surgeon.js';
import type { WitnessRecord, PropagationRecord, PolicyPointer } from '../../packages/host-rpc-server/src/ruclawfleet-types.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const STUB_POLICY: PolicyPointer = {
  policy_version: 'test-v1',
  policy_hash: 'test-hash',
  policy_store_path: 'test/policy.md',
};

function makeWitness(overrides: Partial<WitnessRecord> = {}): WitnessRecord {
  return {
    witness_id: 'wr-001',
    artifact_id: 'artifact-001',
    event_type: 'intake',
    event_at: new Date().toISOString(),
    actor: 'ruclawfleet-pipeline',
    policy_basis: STUB_POLICY,
    state_hash: 'abc123',
    prior_witness_id: null,
    ...overrides,
  };
}

function makePropagation(overrides: Partial<PropagationRecord> = {}): PropagationRecord {
  return {
    propagation_id: 'prp-001',
    artifact_id: 'artifact-001',
    admission_id: 'adm-001',
    source_state: 'admitted_local',
    target_plane: 'case_local_workspace',
    target_scope: 'single_node',
    permitted_form: 'summary',
    decision: 'local_only',
    decider: 'system',
    policy_basis: STUB_POLICY,
    required_witnesses: ['wr-001'],
    created_at: new Date().toISOString(),
    witness_id: 'wr-001',
    ...overrides,
  };
}

function makeHazmatResult(
  overrides: Partial<HazmatClassificationResult> = {},
): HazmatClassificationResult {
  return {
    artifactId:              'test-artifact',
    analyzerMode:            'hazmat_classification',
    attackType:              'benign',
    vector:                  'none',
    characteristics:         [],
    coreIntent:              'benign content',
    confidence:              0.9,
    confidenceBand:          'high',
    analystNote:             '',
    rawSeenBy:               ['hunter', 'explainer'],
    raw:                     '{}',
    source:                  'stub',
    checksApplied:           Object.values(HAZMAT_CHECKS) as string[],
    checksFailed:            [],
    policyVersion:           'test-v1',
    classifierVersion:       'stub-1.0.0',
    suspicionEstablished:    true,
    classificationTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

// WASM-STUB: mock CohomologyEngine for unit tests
function makeMockEngine(
  energyScore = 0.2,
  obstructions: unknown[] = [],
): CohomologyEngineInterface {
  return {
    consistencyEnergy: (_graph: unknown) => energyScore, // WASM-STUB
    detectObstructions: (_graph: unknown) => obstructions, // WASM-STUB
    computeGlobalSections: (_graph: unknown) => ({}), // WASM-STUB
  };
}

// ---------------------------------------------------------------------------
// buildSheafGraph — graph construction
// ---------------------------------------------------------------------------

describe('buildSheafGraph — empty records', () => {
  it('creates a graph with only the focal node when records is empty', () => {
    const focal = makePropagation();
    const graph = buildSheafGraph([], focal);
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]!.id).toBe('prp-001');
    expect(graph.edges).toHaveLength(0);
  });
});

describe('buildSheafGraph — single witness', () => {
  it('creates two nodes and an edge when witness shares artifact_id and is a write event', () => {
    const wr = makeWitness({ event_type: 'intake' });
    const focal = makePropagation({ witness_id: 'wr-001' });
    const graph = buildSheafGraph([wr], focal);
    expect(graph.nodes).toHaveLength(2);
    // Should have an edge from wr to focal (shared artifact_id + write event)
    expect(graph.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('does not add write-op edge for non-write event types with different artifact_id', () => {
    const wr = makeWitness({ event_type: 'classification', artifact_id: 'artifact-001' });
    // Use a different witness_id on focal so the admission-witness lookup does not fire
    const focal = makePropagation({ artifact_id: 'other-artifact', witness_id: 'wr-999' });
    const graph = buildSheafGraph([wr], focal);
    // No shared artifact_id + no write event → no edges from wr-001 to prp-001
    expect(graph.edges.filter((e) => e.from === 'wr-001' && e.to === 'prp-001')).toHaveLength(0);
  });

  it('assigns positive edge weight', () => {
    const wr = makeWitness({ event_type: 'intake' });
    const focal = makePropagation({ witness_id: 'wr-001' });
    const graph = buildSheafGraph([wr], focal);
    for (const edge of graph.edges) {
      expect(edge.weight).toBeGreaterThan(0);
    }
  });
});

describe('buildSheafGraph — multiple witnesses', () => {
  it('builds chain edges from prior_witness_id links', () => {
    const wr1 = makeWitness({ witness_id: 'wr-001', prior_witness_id: null });
    const wr2 = makeWitness({ witness_id: 'wr-002', prior_witness_id: 'wr-001', event_type: 'classification' });
    const focal = makePropagation({ witness_id: 'wr-002' });
    const graph = buildSheafGraph([wr1, wr2], focal);
    expect(graph.nodes).toHaveLength(3);
    const chainEdge = graph.edges.find((e) => e.from === 'wr-001' && e.to === 'wr-002');
    expect(chainEdge).toBeDefined();
  });

  it('includes focal propagation node with correct recordType', () => {
    const focal = makePropagation();
    const graph = buildSheafGraph([], focal);
    const focalNode = graph.nodes.find((n) => n.id === 'prp-001');
    expect(focalNode?.recordType).toBe('propagation');
  });

  it('witness nodes have recordType witness', () => {
    const wr = makeWitness();
    const focal = makePropagation();
    const graph = buildSheafGraph([wr], focal);
    const wrNode = graph.nodes.find((n) => n.id === 'wr-001');
    expect(wrNode?.recordType).toBe('witness');
  });

  it('extracts namespace from policy_reference_store target_plane', () => {
    const focal = makePropagation({ target_plane: 'policy_reference_store' });
    const graph = buildSheafGraph([], focal);
    const focalNode = graph.nodes.find((n) => n.id === focal.propagation_id);
    expect(focalNode?.namespace).toBe('policy');
  });

  it('extracts namespace from actor field', () => {
    const wr = makeWitness({ actor: 'memory_controller' });
    const focal = makePropagation();
    const graph = buildSheafGraph([wr], focal);
    const wrNode = graph.nodes.find((n) => n.id === 'wr-001');
    expect(wrNode?.namespace).toBe('memory');
  });
});

// ---------------------------------------------------------------------------
// classifyIntent — each intent class
// ---------------------------------------------------------------------------

describe('classifyIntent', () => {
  it('classifies policy_reference_store as policy', () => {
    expect(classifyIntent(makePropagation({ target_plane: 'policy_reference_store' }))).toBe('policy');
  });

  it('classifies fleet_shared_memory as memory', () => {
    expect(classifyIntent(makePropagation({ target_plane: 'fleet_shared_memory' }))).toBe('memory');
  });

  it('classifies model_finetuning_corpus as propagation', () => {
    expect(classifyIntent(makePropagation({ target_plane: 'model_finetuning_corpus' }))).toBe('propagation');
  });

  it('classifies approved_lesson_store as propagation', () => {
    expect(classifyIntent(makePropagation({ target_plane: 'approved_lesson_store' }))).toBe('propagation');
  });

  it('classifies analyst_quarantine as security', () => {
    expect(classifyIntent(makePropagation({ target_plane: 'analyst_quarantine' }))).toBe('security');
  });

  it('classifies feature_vector permitted_form as security', () => {
    expect(classifyIntent(makePropagation({ permitted_form: 'feature_vector' }))).toBe('security');
  });

  it('classifies case_local_workspace as benign', () => {
    expect(classifyIntent(makePropagation({ target_plane: 'case_local_workspace' }))).toBe('benign');
  });

  it('classifies policy_signal permitted_form as policy', () => {
    expect(classifyIntent(makePropagation({ permitted_form: 'policy_signal' }))).toBe('policy');
  });

  it('returns unknown for unrecognised target_plane and form', () => {
    expect(classifyIntent(makePropagation({
      target_plane: 'external_export',
      permitted_form: 'raw',
    }))).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// mapEnergyToPrivilege — boundary values
// ---------------------------------------------------------------------------

describe('mapEnergyToPrivilege — boundary values', () => {
  it('returns full for energy 0.0', () => {
    expect(mapEnergyToPrivilege(0.0)).toBe('full');
  });

  it('returns full for energy 0.29', () => {
    expect(mapEnergyToPrivilege(0.29)).toBe('full');
  });

  it('returns restricted for energy exactly 0.3', () => {
    expect(mapEnergyToPrivilege(0.3)).toBe('restricted');
  });

  it('returns restricted for energy 0.5', () => {
    expect(mapEnergyToPrivilege(0.5)).toBe('restricted');
  });

  it('returns read-only for energy exactly 0.6', () => {
    expect(mapEnergyToPrivilege(0.6)).toBe('read-only');
  });

  it('returns read-only for energy 0.74', () => {
    expect(mapEnergyToPrivilege(0.74)).toBe('read-only');
  });

  it('returns suspended for energy exactly 0.75', () => {
    expect(mapEnergyToPrivilege(0.75)).toBe('suspended');
  });

  it('returns suspended for energy 1.0', () => {
    expect(mapEnergyToPrivilege(1.0)).toBe('suspended');
  });

  it('returns suspended for energy > 1.0 (overflow guard)', () => {
    expect(mapEnergyToPrivilege(2.0)).toBe('suspended');
  });
});

// ---------------------------------------------------------------------------
// analyzeContribution — RuPiSignal shape with mocked CohomologyEngine
// ---------------------------------------------------------------------------

describe('analyzeContribution — RuPiSignal shape', () => {
  let engine: RuPiCoherenceEngine;

  beforeEach(() => {
    engine = new RuPiCoherenceEngine({ energyThreshold: 0.75 });
    engine.injectEngine(makeMockEngine(0.2, [])); // WASM-STUB
  });

  it('throws RuPiNotInitializedError before initialize/inject', async () => {
    const uninitialised = new RuPiCoherenceEngine();
    await expect(
      uninitialised.analyzeContribution([], makePropagation()),
    ).rejects.toThrow(RuPiNotInitializedError);
  });

  it('returns a RuPiSignal with all required fields', async () => {
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal).toHaveProperty('energyScore');
    expect(signal).toHaveProperty('obstructions');
    expect(signal).toHaveProperty('privilegeLevel');
    expect(signal).toHaveProperty('intentClass');
    expect(signal).toHaveProperty('structurallySensitive');
    expect(signal).toHaveProperty('recommendation');
  });

  it('reflects mock energy score in signal', async () => {
    engine.injectEngine(makeMockEngine(0.1)); // WASM-STUB
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal.energyScore).toBe(0.1);
  });

  it('returns privilegeLevel full for low energy', async () => {
    engine.injectEngine(makeMockEngine(0.1)); // WASM-STUB
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal.privilegeLevel).toBe('full');
  });

  it('returns suspended privilegeLevel when energy exceeds threshold', async () => {
    engine.injectEngine(makeMockEngine(0.9)); // WASM-STUB
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal.privilegeLevel).toBe('suspended');
  });

  it('sets structurallySensitive true when energy exceeds threshold', async () => {
    engine.injectEngine(makeMockEngine(0.9)); // WASM-STUB
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal.structurallySensitive).toBe(true);
  });

  it('sets structurallySensitive true when target is high-consequence namespace', async () => {
    engine.injectEngine(makeMockEngine(0.1)); // WASM-STUB — low energy, but policy namespace
    const signal = await engine.analyzeContribution(
      [],
      makePropagation({ target_plane: 'policy_reference_store' }),
    );
    expect(signal.structurallySensitive).toBe(true);
  });

  it('sets structurallySensitive false for low-energy non-sensitive target', async () => {
    engine.injectEngine(makeMockEngine(0.1)); // WASM-STUB
    const signal = await engine.analyzeContribution(
      [],
      makePropagation({ target_plane: 'case_local_workspace' }),
    );
    expect(signal.structurallySensitive).toBe(false);
  });

  it('propagates obstructions from mock engine', async () => {
    engine.injectEngine(makeMockEngine(0.2, [{ type: 'cycle' }, { type: 'gap' }])); // WASM-STUB
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal.obstructions).toHaveLength(2);
  });

  it('classifies intent from target_plane', async () => {
    const signal = await engine.analyzeContribution(
      [],
      makePropagation({ target_plane: 'fleet_shared_memory' }),
    );
    expect(signal.intentClass).toBe('memory');
  });

  it('recommendation is allow for full privilege non-sensitive contribution', async () => {
    engine.injectEngine(makeMockEngine(0.1)); // WASM-STUB
    const signal = await engine.analyzeContribution(
      [],
      makePropagation({ target_plane: 'case_local_workspace' }),
    );
    expect(signal.recommendation).toBe('allow');
  });

  it('recommendation is deny for suspended privilege', async () => {
    engine.injectEngine(makeMockEngine(0.9)); // WASM-STUB
    const signal = await engine.analyzeContribution([], makePropagation());
    expect(signal.recommendation).toBe('deny');
  });
});

// ---------------------------------------------------------------------------
// applyAdmissionPolicy with RuPiSignal — backward compatibility and extensions
// ---------------------------------------------------------------------------

describe('applyAdmissionPolicy — ruPiSignal absent (backward compatible)', () => {
  it('still quarantines non-benign without ruPiSignal', () => {
    const r = makeHazmatResult({ attackType: 'instruction-injection', confidenceBand: 'high' });
    const d = applyAdmissionPolicy(r);
    expect(d.category).toBe('quarantine');
    expect(d.allowPropagation).toBe(false);
  });

  it('still admits benign without ruPiSignal', () => {
    const r = makeHazmatResult({ attackType: 'benign', confidenceBand: 'high' });
    const d = applyAdmissionPolicy(r);
    expect(d.category).toBe('admit');
    expect(d.allowPropagation).toBe(true);
  });

  it('still drops when checksFailed without ruPiSignal', () => {
    const r = makeHazmatResult({ checksFailed: [HAZMAT_CHECKS.ALLOWLIST_VALIDATED] });
    const d = applyAdmissionPolicy(r);
    expect(d.category).toBe('drop');
  });
});

describe('applyAdmissionPolicy — suspended ruPiSignal forces quarantine', () => {
  it('overrides benign admission to quarantine when privilegeLevel=suspended', () => {
    const r = makeHazmatResult({ attackType: 'benign' });
    const signal: RuPiSignal = {
      energyScore: 0.9,
      obstructions: [],
      privilegeLevel: 'suspended',
      intentClass: 'unknown',
      structurallySensitive: true,
      recommendation: 'deny',
    };
    const d = applyAdmissionPolicy(r, signal);
    expect(d.category).toBe('quarantine');
    expect(d.allowPropagation).toBe(false);
    expect(d.requireHumanReview).toBe(true);
    expect(d.reason).toContain('suspended privilege');
  });
});

describe('applyAdmissionPolicy — structurallySensitive overrides benign admission', () => {
  it('quarantines a benign contribution targeting policy namespace', () => {
    const r = makeHazmatResult({ attackType: 'benign' });
    const signal: RuPiSignal = {
      energyScore: 0.1,
      obstructions: [],
      privilegeLevel: 'full',
      intentClass: 'policy',
      structurallySensitive: true,
      recommendation: 'restrict',
    };
    const d = applyAdmissionPolicy(r, signal);
    expect(d.category).toBe('quarantine');
    expect(d.allowPropagation).toBe(false);
    expect(d.reason).toContain('structurally sensitive');
  });
});

describe('applyAdmissionPolicy — non-suspended signal does not affect quarantine logic', () => {
  it('keeps quarantine for non-benign even with full privilege signal', () => {
    const r = makeHazmatResult({
      attackType: 'social-engineering',
      confidenceBand: 'medium',
    });
    const signal: RuPiSignal = {
      energyScore: 0.1,
      obstructions: [],
      privilegeLevel: 'full',
      intentClass: 'benign',
      structurallySensitive: false,
      recommendation: 'allow',
    };
    const d = applyAdmissionPolicy(r, signal);
    expect(d.category).toBe('quarantine');
    expect(d.allowPropagation).toBe(false);
  });
});
