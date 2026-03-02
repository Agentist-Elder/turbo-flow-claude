/**
 * Phase 15 — Coherence Pipeline (The Central Nervous System)
 *
 * Single-facade assembly line that wires together all Mothership pipeline
 * components into one deterministic, auditable conveyor belt:
 *
 *   processIncomingPayload(raw) →
 *     1. orchestrator.routePayload()          — gateway → RC code → route
 *                                               fires Neuralyzer (fire-and-forget) if quarantined
 *     2a. outcome='clean'      → memoryIngester.ingest(source='clean-stream')
 *     2b. outcome='quarantined'→ quarantineProcessor.process()
 *                                  → sanitized: memoryIngester.ingest(source='sanitized')
 *                                  → discarded:  return quarantine-discarded
 *     2c. outcome='dropped'    → return dropped (no downstream calls)
 *
 * Race-condition analysis (Neuralyzer vs. Surgeon):
 *   The Neuralyzer operates on process lifecycle (OS-level kill/wipe/respawn).
 *   The Surgeon operates on payload bytes held in memory.
 *   They share NO mutable state.  The orchestrator fires the Neuralyzer as a
 *   void side-effect inside routePayload(); the pipeline immediately receives
 *   the RouterResult and proceeds to await the Surgeon sequentially.
 *   Result: zero race conditions.
 *
 * All dependencies are injected via thin interfaces so the pipeline can be
 * unit-tested without HTTP servers, WASM modules, ONNX models, or vector DBs.
 */

import type { RouterResult, QuarantineRecord } from './coherence-router.js';
import type { ProcessorResult } from './quarantine-processor.js';
import type { IngestionResult, DocumentMetadata } from './memory-ingestion.js';

// ---------------------------------------------------------------------------
// Injectable interfaces (production → real classes; tests → stubs)
// ---------------------------------------------------------------------------

/**
 * Thin interface over SwarmOrchestrator.
 *
 * Production:  SwarmOrchestrator, which wraps CoherenceRouter + CoherenceClient
 *              and fires the Neuralyzer on quarantine as a fire-and-forget side-effect.
 * Tests:       A stub that returns a controlled RouterResult.
 */
export interface IRouterOrchestrator {
  routePayload(payload: Buffer, daughterId: string): Promise<RouterResult>;
}

/**
 * Thin interface over QuarantineProcessor.
 *
 * Production:  QuarantineProcessor (Phase 13).
 * Tests:       A stub returning a controlled ProcessorResult.
 */
export interface IQuarantineProcessor {
  process(record: QuarantineRecord): Promise<ProcessorResult>;
}

/**
 * Thin interface over MemoryIngester.
 *
 * Production:  MemoryIngester (Phase 14) backed by ruvector-mem.
 * Tests:       A stub returning a controlled IngestionResult.
 */
export interface IMemoryIngester {
  ingest(text: string, metadata: DocumentMetadata): Promise<IngestionResult>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input to the pipeline — one unit of data from a Daughter agent. */
export interface RawPayload {
  /** ID of the Daughter agent submitting content. */
  daughterId: string;
  /** Raw binary content (UTF-8 assumed for clean-path ingestion). */
  content: Buffer;
}

/** All possible outcomes of a single pipeline run. */
export type PipelineOutcome =
  | 'ingested'              // RC_ALLOW → Memory Ingester (clean stream)
  | 'quarantine-ingested'   // quarantined → Surgeon sanitized → Memory Ingester
  | 'quarantine-discarded'  // quarantined → Surgeon discarded (reject-mode or entirely-contaminated)
  | 'dropped';              // gateway error or router drop (fail-closed)

/** Result returned by processIncomingPayload() after a complete pipeline run. */
export interface PipelineResult {
  outcome: PipelineOutcome;
  daughterId: string;
  /**
   * UUID of the stored document.
   * Present when outcome is 'ingested' or 'quarantine-ingested'.
   */
  documentId?: string;
  /**
   * Number of chunks stored in the vector database.
   * Present when outcome is 'ingested' or 'quarantine-ingested'.
   */
  chunksStored?: number;
  /**
   * Reason the payload was discarded.
   * Present when outcome is 'quarantine-discarded'.
   */
  discardReason?: 'reject-mode' | 'entirely-contaminated';
}

/**
 * Mutable telemetry counters.
 * Updated on every processIncomingPayload() call; never reset by the pipeline.
 * Expose to the Mothership dashboard or any logging sink via the stats property.
 */
export interface PipelineStats {
  /** Total payloads submitted to the pipeline. */
  totalProcessed: number;
  /** Payloads that passed the gateway and were ingested cleanly. */
  totalClean: number;
  /** Payloads that were quarantined (regardless of Surgeon outcome). */
  totalQuarantined: number;
  /**
   * Payloads that triggered the Neuralyzer sequence.
   * Equals totalQuarantined under current routing policy.
   */
  totalNeuralyzed: number;
}

export interface PipelineConfig {
  /** Routes payloads through gateway; fires Neuralyzer on quarantine. */
  orchestrator: IRouterOrchestrator;
  /** Sanitizes quarantined payloads via SemanticChunker (Phase 21). */
  quarantineProcessor: IQuarantineProcessor;
  /** Stores clean / sanitized content in the vector database (Phase 14). */
  memoryIngester: IMemoryIngester;
}

// ---------------------------------------------------------------------------
// CoherencePipeline
// ---------------------------------------------------------------------------

/**
 * CoherencePipeline — The Central Nervous System.
 *
 * Stateless beyond its mutable stats counter and injected dependencies.
 * Safe to share across concurrent callers (each call awaits its own chain
 * sequentially; stats increments are single-threaded within the JS event loop).
 */
export class CoherencePipeline {
  private readonly orchestrator:        IRouterOrchestrator;
  private readonly quarantineProcessor: IQuarantineProcessor;
  private readonly memoryIngester:      IMemoryIngester;

  /** Live telemetry counters — read-only to external consumers. */
  readonly stats: PipelineStats = {
    totalProcessed:   0,
    totalClean:       0,
    totalQuarantined: 0,
    totalNeuralyzed:  0,
  };

  constructor(config: PipelineConfig) {
    this.orchestrator        = config.orchestrator;
    this.quarantineProcessor = config.quarantineProcessor;
    this.memoryIngester      = config.memoryIngester;
  }

  /**
   * The single entry point for all Daughter agent data.
   *
   * Runs the full conveyor-belt sequence and returns a PipelineResult
   * describing the final disposition of the payload.
   *
   * @param raw  Raw payload from a Daughter agent.
   */
  async processIncomingPayload(raw: RawPayload): Promise<PipelineResult> {
    const { daughterId, content } = raw;
    this.stats.totalProcessed++;

    // -----------------------------------------------------------------------
    // Step 1: Route via orchestrator.
    //   - Internally calls CoherenceRouter → CoherenceClient → L3 Gateway.
    //   - On RC_ALLOW:                returns { outcome: 'clean' }.
    //   - On RC_DENY/CHALLENGE/QUARANTINE: fires Neuralyzer (fire-and-forget)
    //                                      and returns { outcome: 'quarantined' }.
    //   - On gateway error:            returns { outcome: 'dropped' }.
    // -----------------------------------------------------------------------
    const routerResult = await this.orchestrator.routePayload(content, daughterId);

    // -----------------------------------------------------------------------
    // Step 2a: Clean path — RC_ALLOW.
    // -----------------------------------------------------------------------
    if (routerResult.outcome === 'clean') {
      this.stats.totalClean++;

      const ingested = await this.memoryIngester.ingest(
        content.toString('utf-8'),
        { daughterId, source: 'clean-stream' },
      );

      return {
        outcome:      'ingested',
        daughterId,
        documentId:   ingested.documentId,
        chunksStored: ingested.chunksStored,
      };
    }

    // -----------------------------------------------------------------------
    // Step 2c: Dropped path — gateway / network failure.
    // Fail-closed: do not call the Surgeon or the ingester.
    // -----------------------------------------------------------------------
    if (routerResult.outcome === 'dropped') {
      return { outcome: 'dropped', daughterId };
    }

    // -----------------------------------------------------------------------
    // Step 2b: Quarantine path — RC_DENY | RC_CHALLENGE | RC_QUARANTINE.
    //
    // The Neuralyzer was already fired (fire-and-forget) by the orchestrator.
    // Now await the Surgeon (QuarantineProcessor) synchronously to determine
    // whether a sanitized remnant can be stored.
    // -----------------------------------------------------------------------
    this.stats.totalQuarantined++;
    this.stats.totalNeuralyzed++;

    const record = routerResult.quarantineRecord!; // guaranteed by router on 'quarantined'
    const processorResult = await this.quarantineProcessor.process(record);

    // Step 3 (Recovery): Surgeon produced clean segments — ingest the remnant.
    if (processorResult.outcome === 'sanitized') {
      const ingested = await this.memoryIngester.ingest(
        processorResult.cleanText,
        { daughterId, source: 'sanitized' },
      );

      return {
        outcome:      'quarantine-ingested',
        daughterId,
        documentId:   ingested.documentId,
        chunksStored: ingested.chunksStored,
      };
    }

    // Surgeon discarded the payload entirely — nothing to store.
    return {
      outcome:       'quarantine-discarded',
      daughterId,
      discardReason: processorResult.discardReason,
    };
  }
}
