/**
 * Ru Pi Coherence Layer
 *
 * The adaptive analytical brain inside RuCLAW Fleet. Sits between the
 * deterministic witnessed layer (WitnessRecord, PropagationRecord) and
 * the admission/propagation decision layer (applyAdmissionPolicy).
 *
 * Architecture position:
 *   [deterministic witnessed layer] — WitnessRecord, PropagationRecord
 *        ↓
 *   [Ru Pi layer]  ← THIS MODULE
 *     - builds sheaf graph from WitnessRecord / PropagationRecord entries
 *     - calls CohomologyEngine.consistencyEnergy(graph) → energy score
 *     - calls detectObstructions(graph) → obstruction list
 *     - classifies contribution intent
 *     - returns RuPiSignal
 *        ↓
 *   [applyAdmissionPolicy()] — extended to accept optional RuPiSignal
 *        ↓
 *   [π.ruv.io collective]
 *
 * IMPORTANT: initialize() MUST be called before analyzeContribution().
 * The WASM module is asynchronously loaded; calling analyzeContribution()
 * before initialize() resolves will throw RuPiNotInitializedError.
 *
 * WASM stub note: tests use a mock CohomologyEngine marked with // WASM-STUB.
 * The real CohomologyEngine from prime-radiant-advanced-wasm is used in
 * production via RuPiCoherenceEngine.initialize().
 *
 * Design constraints:
 *   - No I/O: does not write records, does not emit WitnessRecords
 *   - Pi may NOT set any field on a PropagationRecord directly (ruclawfleet-types.ts §6)
 *   - RUPI_ENERGY_THRESHOLD default=0.75 (env var override: RUPI_ENERGY_THRESHOLD)
 *   - Wake-up radius: last 5 records by shared participant_id OR shared target namespace
 *   - High-consequence namespaces: 'policy', 'memory', 'endorsement'
 */

// ---------------------------------------------------------------------------
// Pseudocode — algorithm outline (retained as comments for traceability)
//
// buildSheafGraph(records, focal):
//   1. Collect all records (WitnessRecord[] + focal PropagationRecord) as graph nodes
//   2. For each pair (a, b): add directed edge a → b if a references b in a write op
//      - WitnessRecord references: if a.artifact_id == b.artifact_id AND
//        a's event_type represents a write (intake, write_back, supersession)
//      - PropagationRecord references: artifact_id and admission_id FK linkage
//   3. Edge weight = recency_factor × reference_frequency
//      where recency_factor = 1 / (1 + age_seconds / 3600)
//   4. Annotate each node with namespace extracted from actor/target fields
//   5. Return graph as plain JS object (serializable for WASM input)
//
// analyzeContribution(records, newRecord):
//   1. Filter wake-up radius: last 5 records sharing participant_id OR namespace
//   2. buildSheafGraph(filteredRecords, newRecord)
//   3. engine.consistencyEnergy(graph) → energyScore
//   4. engine.detectObstructions(graph) → obstructions[]
//   5. classifyIntent(newRecord) → intentClass
//   6. Determine structurallySensitive: energyScore > threshold OR writes near
//      high-consequence namespace (policy, memory, endorsement)
//   7. mapEnergyToPrivilege(energyScore) → privilegeLevel
//   8. Determine recommendation from privilegeLevel
//   9. Return RuPiSignal
// ---------------------------------------------------------------------------

import type { WitnessRecord, PropagationRecord } from './ruclawfleet-types.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ContributionIntent =
  | 'security'
  | 'policy'
  | 'memory'
  | 'propagation'
  | 'benign'
  | 'unknown';

export type PrivilegeLevel = 'full' | 'restricted' | 'read-only' | 'suspended';

export interface RuPiSignal {
  /** Raw sheaf cohomology energy score from CohomologyEngine. Lower = consistent. */
  energyScore: number;
  /** Structural inconsistencies detected by WASM detectObstructions(). */
  obstructions: unknown[];
  /** Privilege level derived from energyScore via RUPI_ENERGY_THRESHOLD. */
  privilegeLevel: PrivilegeLevel;
  /** Classified contribution intent from PropagationRecord fields. */
  intentClass: ContributionIntent;
  /**
   * True when energyScore > RUPI_ENERGY_THRESHOLD OR the write touches a node
   * within 1 hop of a high-consequence namespace (policy, memory, endorsement).
   */
  structurallySensitive: boolean;
  /** Recommended action derived from privilegeLevel and structurallySensitive. */
  recommendation: 'allow' | 'restrict' | 'quarantine' | 'deny';
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** A node in the sheaf graph — wraps a record with metadata. */
interface SheafNode {
  id: string;
  recordType: 'witness' | 'propagation';
  artifactId: string;
  namespace: string;
  actor?: string;
  eventType?: string;
  targetPlane?: string;
  createdAt: string;
}

/** A directed edge in the sheaf graph with recency-weighted strength. */
interface SheafEdge {
  from: string;   // node id
  to: string;     // node id
  weight: number; // recency_factor × reference_frequency
}

/** Plain JS object passed to WASM CohomologyEngine. */
export interface SheafGraph {
  nodes: SheafNode[];
  edges: SheafEdge[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_ENERGY_THRESHOLD = 0.75;

/** Namespaces considered high-consequence — writes near these trigger sensitivity. */
const HIGH_CONSEQUENCE_NAMESPACES = new Set(['policy', 'memory', 'endorsement']);

/** Write-type events in a WitnessRecord that establish a directed reference. */
const WRITE_EVENT_TYPES = new Set<string>([
  'intake',
  'write_back',
  'supersession',
  'break_glass_triggered',
]);

/** Maximum records in the wake-up radius. */
const WAKE_UP_RADIUS = 5;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RuPiNotInitializedError extends Error {
  constructor() {
    super(
      'RuPiCoherenceEngine.initialize() must be called before analyzeContribution(). ' +
      'WASM module has not been loaded.',
    );
    this.name = 'RuPiNotInitializedError';
  }
}

// ---------------------------------------------------------------------------
// Pure helper: extract namespace from a WitnessRecord or PropagationRecord
// ---------------------------------------------------------------------------

function extractNamespace(record: WitnessRecord | PropagationRecord): string {
  // WitnessRecord: derive from actor field (e.g. 'policy_engine' → 'policy')
  if ('actor' in record) {
    const actor = record.actor.toLowerCase();
    for (const ns of HIGH_CONSEQUENCE_NAMESPACES) {
      if (actor.includes(ns)) return ns;
    }
    return record.actor.split(/[-_]/)[0] ?? 'unknown';
  }
  // PropagationRecord: derive from target_plane (e.g. 'policy_reference_store' → 'policy')
  if ('target_plane' in record) {
    const plane = record.target_plane.toLowerCase();
    for (const ns of HIGH_CONSEQUENCE_NAMESPACES) {
      if (plane.includes(ns)) return ns;
    }
    return record.target_plane.split('_')[0] ?? 'unknown';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Pure helper: compute edge weight
// ---------------------------------------------------------------------------

function edgeWeight(nodeCreatedAt: string, referenceFrequency: number): number {
  const ageMs = Date.now() - new Date(nodeCreatedAt).getTime();
  const ageSeconds = Math.max(0, ageMs / 1000);
  const recencyFactor = 1 / (1 + ageSeconds / 3600);
  return recencyFactor * referenceFrequency;
}

// ---------------------------------------------------------------------------
// Exported pure function: buildSheafGraph
// ---------------------------------------------------------------------------

/**
 * Build a sheaf graph from WitnessRecord context and a focal PropagationRecord.
 *
 * Nodes: each record becomes a node.
 * Edges: directed edge A → B when A references B via write operation and they
 *        share the same artifact_id. Edge weight encodes recency and frequency.
 *
 * The graph is a plain JS object — safe to pass directly to the WASM engine.
 */
export function buildSheafGraph(
  records: WitnessRecord[],
  focal: PropagationRecord,
): SheafGraph {
  const nodes: SheafNode[] = [];
  const edges: SheafEdge[] = [];

  // Build witness nodes
  for (const wr of records) {
    nodes.push({
      id: wr.witness_id,
      recordType: 'witness',
      artifactId: wr.artifact_id,
      namespace: extractNamespace(wr),
      actor: wr.actor,
      eventType: wr.event_type,
      createdAt: wr.event_at,
    });
  }

  // Build focal propagation node
  const focalId = focal.propagation_id;
  nodes.push({
    id: focalId,
    recordType: 'propagation',
    artifactId: focal.artifact_id,
    namespace: extractNamespace(focal),
    targetPlane: focal.target_plane,
    createdAt: focal.created_at,
  });

  // Build edges: track how many times each source → target connection appears
  const edgeFrequency = new Map<string, { from: string; to: string; count: number; fromCreatedAt: string }>();

  const recordById = new Map<string, { createdAt: string }>();
  for (const n of nodes) recordById.set(n.id, { createdAt: n.createdAt });

  // Witness → witness edges: sequential chain via prior_witness_id
  for (const wr of records) {
    if (wr.prior_witness_id !== null) {
      const key = `${wr.prior_witness_id}→${wr.witness_id}`;
      const existing = edgeFrequency.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeFrequency.set(key, {
          from: wr.prior_witness_id,
          to: wr.witness_id,
          count: 1,
          fromCreatedAt: wr.event_at,
        });
      }
    }
    // Write-op references: if this event is a write type and shares artifact_id with focal
    if (WRITE_EVENT_TYPES.has(wr.event_type) && wr.artifact_id === focal.artifact_id) {
      const key = `${wr.witness_id}→${focalId}`;
      const existing = edgeFrequency.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeFrequency.set(key, {
          from: wr.witness_id,
          to: focalId,
          count: 1,
          fromCreatedAt: wr.event_at,
        });
      }
    }
  }

  // Focal propagation → its admission witness (if present in records)
  const admissionWitness = records.find(
    (wr) => wr.witness_id === focal.witness_id,
  );
  if (admissionWitness) {
    const key = `${admissionWitness.witness_id}→${focalId}`;
    if (!edgeFrequency.has(key)) {
      edgeFrequency.set(key, {
        from: admissionWitness.witness_id,
        to: focalId,
        count: 1,
        fromCreatedAt: admissionWitness.event_at,
      });
    }
  }

  // Build final edge list with computed weights
  for (const { from, to, count, fromCreatedAt } of edgeFrequency.values()) {
    // Only add edge if both nodes exist in the graph
    const fromExists = nodes.some((n) => n.id === from);
    const toExists   = nodes.some((n) => n.id === to);
    if (fromExists && toExists) {
      edges.push({ from, to, weight: edgeWeight(fromCreatedAt, count) });
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Exported pure function: classifyIntent
// ---------------------------------------------------------------------------

/**
 * Classify the contribution intent of a PropagationRecord.
 *
 * Intent is derived from the target_plane and permitted_form fields.
 * This is a heuristic classification — not a security gate.
 */
export function classifyIntent(record: PropagationRecord): ContributionIntent {
  const plane = record.target_plane.toLowerCase();
  const form  = record.permitted_form.toLowerCase();

  if (plane.includes('policy')) return 'policy';
  if (plane.includes('memory') || plane.includes('fleet_shared_memory')) return 'memory';
  if (plane.includes('finetuning') || plane.includes('lesson')) return 'propagation';
  if (form === 'policy_signal') return 'policy';
  if (form === 'label' || form === 'feature_vector') return 'security';
  if (plane.includes('quarantine') || plane.includes('analyst')) return 'security';
  if (plane.includes('workspace') || plane.includes('local')) return 'benign';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Exported pure function: mapEnergyToPrivilege
// ---------------------------------------------------------------------------

/**
 * Map a cohomology energy score to a privilege level.
 *
 * Thresholds:
 *   < 0.3  → 'full'
 *   0.3–0.6 → 'restricted'
 *   0.6–0.75 → 'read-only'
 *   > 0.75  → 'suspended'  (triggers quarantine in applyAdmissionPolicy)
 *
 * Boundary values (exactly 0.3, 0.6, 0.75) belong to the lower band
 * (e.g. energy=0.3 → 'restricted', energy=0.6 → 'read-only').
 */
export function mapEnergyToPrivilege(energy: number): PrivilegeLevel {
  if (energy < 0.3)  return 'full';
  if (energy < 0.6)  return 'restricted';
  if (energy < 0.75) return 'read-only';
  return 'suspended';
}

// ---------------------------------------------------------------------------
// Internal helper: determine if graph touches a high-consequence namespace
// ---------------------------------------------------------------------------

function touchesHighConsequenceNamespace(graph: SheafGraph): boolean {
  return graph.nodes.some((n) => HIGH_CONSEQUENCE_NAMESPACES.has(n.namespace));
}

/**
 * Check if any write-type node in the graph is within 1 hop of a
 * high-consequence namespace node.
 */
function isWithinOneHopOfHighConsequence(graph: SheafGraph): boolean {
  const highConsequenceIds = new Set(
    graph.nodes
      .filter((n) => HIGH_CONSEQUENCE_NAMESPACES.has(n.namespace))
      .map((n) => n.id),
  );

  // Check write-type nodes
  const writeNodeIds = new Set(
    graph.nodes
      .filter((n) => n.eventType && WRITE_EVENT_TYPES.has(n.eventType))
      .map((n) => n.id),
  );

  for (const edge of graph.edges) {
    const fromIsWrite = writeNodeIds.has(edge.from);
    const toIsHigh   = highConsequenceIds.has(edge.to);
    const fromIsHigh = highConsequenceIds.has(edge.from);
    const toIsWrite  = writeNodeIds.has(edge.to);

    if ((fromIsWrite && toIsHigh) || (fromIsHigh && toIsWrite)) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Internal helper: derive recommendation
// ---------------------------------------------------------------------------

function deriveRecommendation(
  privilegeLevel: PrivilegeLevel,
  structurallySensitive: boolean,
): RuPiSignal['recommendation'] {
  if (privilegeLevel === 'suspended') return 'deny';
  if (privilegeLevel === 'read-only' && structurallySensitive) return 'quarantine';
  if (privilegeLevel === 'restricted' || structurallySensitive) return 'restrict';
  return 'allow';
}

// ---------------------------------------------------------------------------
// Internal helper: filter wake-up radius
// ---------------------------------------------------------------------------

function filterWakeUpRadius(
  records: WitnessRecord[],
  focal: PropagationRecord,
): WitnessRecord[] {
  const focalParticipantId = focal.artifact_id; // closest proxy for participant linkage
  const focalNamespace = extractNamespace(focal);

  // Filter: shared artifact_id (closest proxy) OR shared namespace
  const related = records.filter(
    (wr) =>
      wr.artifact_id === focal.artifact_id ||
      extractNamespace(wr) === focalNamespace,
  );

  // Take last WAKE_UP_RADIUS by event_at descending
  return [...related]
    .sort((a, b) => new Date(b.event_at).getTime() - new Date(a.event_at).getTime())
    .slice(0, WAKE_UP_RADIUS);
}

// ---------------------------------------------------------------------------
// RuPiCoherenceEngine — the main class
// ---------------------------------------------------------------------------

/**
 * Ru Pi Coherence Engine.
 *
 * Usage:
 *   const engine = new RuPiCoherenceEngine();
 *   await engine.initialize();   // MUST call before analyzeContribution()
 *   const signal = await engine.analyzeContribution(witnesses, propagation);
 *
 * The engine is safe to initialize once and reuse for the lifetime of the
 * process. WASM is loaded once; subsequent calls to initialize() are no-ops.
 */
export class RuPiCoherenceEngine {
  private cohomologyEngine: CohomologyEngineInterface | null = null;
  private initialized = false;
  private readonly energyThreshold: number;

  constructor(
    opts: {
      /** Override energy threshold (default: RUPI_ENERGY_THRESHOLD env var or 0.75). */
      energyThreshold?: number;
    } = {},
  ) {
    const envThreshold = parseFloat(process.env['RUPI_ENERGY_THRESHOLD'] ?? '');
    this.energyThreshold =
      opts.energyThreshold ??
      (Number.isFinite(envThreshold) ? envThreshold : DEFAULT_ENERGY_THRESHOLD);
  }

  /**
   * Load and initialize the WASM CohomologyEngine.
   * Must be awaited before analyzeContribution() is called.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Dynamic import to avoid WASM initialization in test environments
    // that inject a mock (see WASM-STUB pattern in tests).
    const wasmModule = await import('prime-radiant-advanced-wasm');
    // The default export is the init function; CohomologyEngine is a named export.
    await (wasmModule.default as () => Promise<unknown>)();
    this.cohomologyEngine = new (wasmModule.CohomologyEngine as new () => CohomologyEngineInterface)();
    this.initialized = true;
  }

  /**
   * Inject a mock CohomologyEngine for testing without WASM.
   * Call this instead of initialize() in unit tests.
   * Marked with // WASM-STUB in test files.
   */
  injectEngine(engine: CohomologyEngineInterface): void {
    this.cohomologyEngine = engine;
    this.initialized = true;
  }

  /**
   * Analyze a new PropagationRecord contribution against the witnessed context.
   *
   * Throws RuPiNotInitializedError if initialize() has not been called.
   *
   * @param records   - WitnessRecord context (typically last 5 related by wake-up radius)
   * @param newRecord - The PropagationRecord being evaluated
   * @returns RuPiSignal with energy score, obstructions, privilege level, and recommendation
   */
  async analyzeContribution(
    records: WitnessRecord[],
    newRecord: PropagationRecord,
  ): Promise<RuPiSignal> {
    if (!this.initialized || !this.cohomologyEngine) {
      throw new RuPiNotInitializedError();
    }

    // Step 1: Filter to wake-up radius
    const contextRecords = filterWakeUpRadius(records, newRecord);

    // Step 2: Build sheaf graph
    const graph = buildSheafGraph(contextRecords, newRecord);

    // Step 3: Compute energy score
    let energyScore: number;
    try {
      energyScore = this.cohomologyEngine.consistencyEnergy(graph);
      // Guard against NaN/Infinity from WASM
      if (!Number.isFinite(energyScore)) energyScore = 0.5;
    } catch {
      energyScore = 0.5; // Safe fallback on WASM error
    }

    // Step 4: Detect obstructions
    let obstructions: unknown[] = [];
    try {
      const raw = this.cohomologyEngine.detectObstructions(graph);
      obstructions = Array.isArray(raw) ? raw : [];
    } catch {
      obstructions = [];
    }

    // Step 5: Classify intent
    const intentClass = classifyIntent(newRecord);

    // Step 6: Determine structural sensitivity
    const energyExceedsThreshold = energyScore > this.energyThreshold;
    const nearHighConsequence = isWithinOneHopOfHighConsequence(graph) ||
      touchesHighConsequenceNamespace(graph);
    const structurallySensitive = energyExceedsThreshold || nearHighConsequence;

    // Step 7: Map energy to privilege level
    const privilegeLevel = mapEnergyToPrivilege(energyScore);

    // Step 8: Derive recommendation
    const recommendation = deriveRecommendation(privilegeLevel, structurallySensitive);

    return {
      energyScore,
      obstructions,
      privilegeLevel,
      intentClass,
      structurallySensitive,
      recommendation,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal interface — matches the WASM CohomologyEngine API
// ---------------------------------------------------------------------------

/** Structural contract for CohomologyEngine (WASM or test mock). */
export interface CohomologyEngineInterface {
  consistencyEnergy(graph_js: unknown): number;
  detectObstructions(graph_js: unknown): unknown;
  computeGlobalSections(graph_js: unknown): unknown;
}
