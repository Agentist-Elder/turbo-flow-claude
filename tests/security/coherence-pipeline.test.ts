/**
 * Phase 15 — CoherencePipeline tests
 *
 * All tests use injected stubs — no HTTP, no WASM, no ONNX, no filesystem.
 *
 * Test matrix:
 *   Clean path
 *     - outcome='ingested' when orchestrator returns 'clean'
 *     - memoryIngester called with source='clean-stream' and UTF-8 content
 *     - quarantineProcessor is NOT called on clean path
 *     - PipelineResult.documentId comes from the ingester
 *     - PipelineResult.chunksStored comes from the ingester
 *
 *   Quarantine path — sanitized
 *     - outcome='quarantine-ingested' when surgeon returns 'sanitized'
 *     - memoryIngester called with surgeon's cleanText (not original content)
 *     - memoryIngester called with source='sanitized'
 *     - PipelineResult.documentId and chunksStored from ingester
 *
 *   Quarantine path — discarded (reject-mode)
 *     - outcome='quarantine-discarded', discardReason='reject-mode'
 *     - memoryIngester is NOT called
 *
 *   Quarantine path — discarded (entirely-contaminated)
 *     - outcome='quarantine-discarded', discardReason='entirely-contaminated'
 *     - memoryIngester is NOT called
 *
 *   Dropped path
 *     - outcome='dropped' when orchestrator returns 'dropped'
 *     - quarantineProcessor is NOT called
 *     - memoryIngester is NOT called
 *
 *   PipelineStats
 *     - totalProcessed increments on every call
 *     - totalClean increments on clean path only
 *     - totalQuarantined increments on quarantine path only
 *     - totalNeuralyzed increments on quarantine path
 *     - stats accumulate correctly across multiple mixed calls
 */

import { describe, it, expect } from 'vitest';
import {
  CoherencePipeline,
  IRouterOrchestrator,
  IQuarantineProcessor,
  IMemoryIngester,
  RawPayload,
} from '../../packages/host-rpc-server/src/coherence-pipeline.js';
import type { RouterResult, QuarantineRecord } from '../../packages/host-rpc-server/src/coherence-router.js';
import type { ProcessorResult } from '../../packages/host-rpc-server/src/quarantine-processor.js';
import type { IngestionResult } from '../../packages/host-rpc-server/src/memory-ingestion.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAUGHTER_ID = 'daughter-test';
const CONTENT     = Buffer.from('hello from daughter agent');

/** A minimal QuarantineRecord for the quarantine path. */
const MOCK_QUARANTINE_RECORD: QuarantineRecord = {
  daughterId:  DAUGHTER_ID,
  payload:     CONTENT,
  decision:    'deny',
  mode:        'sanitize',
  timestampNs: BigInt(0),
};

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeOrchestrator(result: RouterResult): IRouterOrchestrator {
  return { routePayload: async () => result };
}

function cleanOrchestrator(): IRouterOrchestrator {
  return makeOrchestrator({ outcome: 'clean', decision: 'allow', daughterId: DAUGHTER_ID });
}

function quarantinedOrchestrator(record: QuarantineRecord = MOCK_QUARANTINE_RECORD): IRouterOrchestrator {
  return makeOrchestrator({
    outcome:           'quarantined',
    decision:          'deny',
    daughterId:        DAUGHTER_ID,
    quarantineRecord:  record,
  });
}

function droppedOrchestrator(): IRouterOrchestrator {
  return makeOrchestrator({ outcome: 'dropped', daughterId: DAUGHTER_ID });
}

function makeProcessor(result: ProcessorResult): IQuarantineProcessor & { calls: number } {
  let calls = 0;
  return {
    get calls() { return calls; },
    process: async () => { calls++; return result; },
  };
}

function sanitizedProcessor(cleanText = 'surgeon cleaned content here'): IQuarantineProcessor & { calls: number } {
  return makeProcessor({
    outcome:       'sanitized',
    daughterId:    DAUGHTER_ID,
    cleanText,
    manifest:      [],
    hadRedactions: false,
  });
}

function discardedProcessor(discardReason: 'reject-mode' | 'entirely-contaminated'): IQuarantineProcessor & { calls: number } {
  return makeProcessor({ outcome: 'discarded', daughterId: DAUGHTER_ID, discardReason });
}

/** Spy ingester that records every call. */
interface IngesterSpy extends IMemoryIngester {
  texts:    string[];
  sources:  string[];
  callCount: number;
}

function makeIngester(documentId = 'doc-abc', chunksStored = 3): IngesterSpy {
  const spy: IngesterSpy = {
    texts:    [],
    sources:  [],
    callCount: 0,
    ingest: async (text, meta) => {
      spy.texts.push(text);
      spy.sources.push(meta.source);
      spy.callCount++;
      const result: IngestionResult = {
        documentId,
        chunksStored,
        chunkIds: Array.from({ length: chunksStored }, (_, i) => `${documentId}-chunk-${i}`),
        metadata: {
          daughterId: meta.daughterId,
          source:     meta.source,
          timestamp:  new Date().toISOString(),
          originUrl:  '',
        },
      };
      return result;
    },
  };
  return spy;
}

/** Convenience: build a pipeline with defaults for parts we don't care about. */
function makePipeline(
  overrides: Partial<{
    orchestrator:        IRouterOrchestrator;
    quarantineProcessor: IQuarantineProcessor;
    memoryIngester:      IMemoryIngester;
  }> = {},
) {
  return new CoherencePipeline({
    orchestrator:        overrides.orchestrator        ?? cleanOrchestrator(),
    quarantineProcessor: overrides.quarantineProcessor ?? sanitizedProcessor(),
    memoryIngester:      overrides.memoryIngester      ?? makeIngester(),
  });
}

/** Standard RawPayload for most tests. */
function rawPayload(content = CONTENT): RawPayload {
  return { daughterId: DAUGHTER_ID, content };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoherencePipeline', () => {

  // ==========================================================================
  // Clean path
  // ==========================================================================

  describe('clean path (RC_ALLOW)', () => {

    it('returns outcome=ingested when orchestrator returns clean', async () => {
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator() });
      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.outcome).toBe('ingested');
    });

    it('calls memoryIngester.ingest() with source=clean-stream', async () => {
      const ingester = makeIngester();
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator(), memoryIngester: ingester });

      await pipeline.processIncomingPayload(rawPayload());

      expect(ingester.sources[0]).toBe('clean-stream');
    });

    it('passes UTF-8 decoded content to memoryIngester on clean path', async () => {
      const content  = Buffer.from('clean agent output text');
      const ingester = makeIngester();
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator(), memoryIngester: ingester });

      await pipeline.processIncomingPayload({ daughterId: DAUGHTER_ID, content });

      expect(ingester.texts[0]).toBe('clean agent output text');
    });

    it('does NOT call quarantineProcessor on clean path', async () => {
      const processor = sanitizedProcessor();
      const pipeline  = makePipeline({ orchestrator: cleanOrchestrator(), quarantineProcessor: processor });

      await pipeline.processIncomingPayload(rawPayload());

      expect(processor.calls).toBe(0);
    });

    it('PipelineResult.documentId reflects the ingester response', async () => {
      const ingester = makeIngester('doc-clean-42');
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator(), memoryIngester: ingester });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.documentId).toBe('doc-clean-42');
    });

    it('PipelineResult.chunksStored reflects the ingester response', async () => {
      const ingester = makeIngester('doc-x', 7);
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator(), memoryIngester: ingester });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.chunksStored).toBe(7);
    });
  });

  // ==========================================================================
  // Quarantine path — sanitized
  // ==========================================================================

  describe('quarantine path — surgeon sanitizes', () => {

    it('returns outcome=quarantine-ingested when surgeon returns sanitized', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
      });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.outcome).toBe('quarantine-ingested');
    });

    it('calls memoryIngester with surgeon cleanText, not original content', async () => {
      const ingester  = makeIngester();
      const cleanText = 'surgeon has excised the contaminated segments here';
      const pipeline  = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(cleanText),
        memoryIngester:      ingester,
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(ingester.texts[0]).toBe(cleanText);
    });

    it('calls memoryIngester with source=sanitized on quarantine-ingested path', async () => {
      const ingester = makeIngester();
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
        memoryIngester:      ingester,
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(ingester.sources[0]).toBe('sanitized');
    });

    it('PipelineResult.documentId comes from the ingester on quarantine-ingested', async () => {
      const ingester = makeIngester('doc-sanitized-99');
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
        memoryIngester:      ingester,
      });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.documentId).toBe('doc-sanitized-99');
    });

    it('PipelineResult.chunksStored comes from the ingester on quarantine-ingested', async () => {
      const ingester = makeIngester('doc-y', 4);
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
        memoryIngester:      ingester,
      });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.chunksStored).toBe(4);
    });
  });

  // ==========================================================================
  // Quarantine path — discarded
  // ==========================================================================

  describe('quarantine path — surgeon discards', () => {

    it('returns outcome=quarantine-discarded with discardReason=reject-mode', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: discardedProcessor('reject-mode'),
      });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.outcome).toBe('quarantine-discarded');
      expect(result.discardReason).toBe('reject-mode');
    });

    it('returns outcome=quarantine-discarded with discardReason=entirely-contaminated', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: discardedProcessor('entirely-contaminated'),
      });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.outcome).toBe('quarantine-discarded');
      expect(result.discardReason).toBe('entirely-contaminated');
    });

    it('does NOT call memoryIngester when surgeon discards', async () => {
      const ingester = makeIngester();
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: discardedProcessor('reject-mode'),
        memoryIngester:      ingester,
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(ingester.callCount).toBe(0);
    });

    it('documentId is absent on quarantine-discarded result', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: discardedProcessor('entirely-contaminated'),
      });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.documentId).toBeUndefined();
    });
  });

  // ==========================================================================
  // Dropped path
  // ==========================================================================

  describe('dropped path (gateway error)', () => {

    it('returns outcome=dropped when orchestrator returns dropped', async () => {
      const pipeline = makePipeline({ orchestrator: droppedOrchestrator() });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.outcome).toBe('dropped');
    });

    it('does NOT call quarantineProcessor on dropped path', async () => {
      const processor = sanitizedProcessor();
      const pipeline  = makePipeline({
        orchestrator:        droppedOrchestrator(),
        quarantineProcessor: processor,
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(processor.calls).toBe(0);
    });

    it('does NOT call memoryIngester on dropped path', async () => {
      const ingester = makeIngester();
      const pipeline = makePipeline({
        orchestrator:   droppedOrchestrator(),
        memoryIngester: ingester,
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(ingester.callCount).toBe(0);
    });

    it('documentId is absent on dropped result', async () => {
      const pipeline = makePipeline({ orchestrator: droppedOrchestrator() });

      const result = await pipeline.processIncomingPayload(rawPayload());

      expect(result.documentId).toBeUndefined();
    });
  });

  // ==========================================================================
  // PipelineStats
  // ==========================================================================

  describe('PipelineStats telemetry', () => {

    it('totalProcessed starts at 0', () => {
      const pipeline = makePipeline();
      expect(pipeline.stats.totalProcessed).toBe(0);
    });

    it('totalProcessed increments on every call regardless of outcome', async () => {
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator() });

      await pipeline.processIncomingPayload(rawPayload());
      await pipeline.processIncomingPayload(rawPayload());
      await pipeline.processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalProcessed).toBe(3);
    });

    it('totalClean increments on clean path', async () => {
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator() });

      await pipeline.processIncomingPayload(rawPayload());
      await pipeline.processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalClean).toBe(2);
    });

    it('totalClean does NOT increment on quarantine path', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalClean).toBe(0);
    });

    it('totalQuarantined increments on quarantine path', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: discardedProcessor('reject-mode'),
      });

      await pipeline.processIncomingPayload(rawPayload());
      await pipeline.processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalQuarantined).toBe(2);
    });

    it('totalQuarantined does NOT increment on clean path', async () => {
      const pipeline = makePipeline({ orchestrator: cleanOrchestrator() });

      await pipeline.processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalQuarantined).toBe(0);
    });

    it('totalNeuralyzed increments on quarantine path (Neuralyzer fires)', async () => {
      const pipeline = makePipeline({
        orchestrator:        quarantinedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
      });

      await pipeline.processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalNeuralyzed).toBe(1);
    });

    it('totalNeuralyzed does NOT increment on clean or dropped paths', async () => {
      const pipeline = makePipeline();

      // Two clean calls, one dropped call.
      await pipeline.processIncomingPayload(rawPayload());
      await pipeline.processIncomingPayload(rawPayload());
      await new CoherencePipeline({
        orchestrator:        droppedOrchestrator(),
        quarantineProcessor: sanitizedProcessor(),
        memoryIngester:      makeIngester(),
      }).processIncomingPayload(rawPayload());

      expect(pipeline.stats.totalNeuralyzed).toBe(0);
    });

    it('stats accumulate correctly across a mixed sequence of outcomes', async () => {
      const cleanOrch      = cleanOrchestrator();
      const quarOrch       = quarantinedOrchestrator();
      const dropOrch       = droppedOrchestrator();
      const processor      = sanitizedProcessor();
      const ingester       = makeIngester();

      // We'll swap orchestrators between calls using a round-robin stub.
      let call = 0;
      const multiOrch: IRouterOrchestrator = {
        routePayload: async (payload, daughterId) => {
          const which = call++ % 3;
          if (which === 0) return cleanOrch.routePayload(payload, daughterId);
          if (which === 1) return quarOrch.routePayload(payload, daughterId);
          return dropOrch.routePayload(payload, daughterId);
        },
      };

      const pipeline = new CoherencePipeline({
        orchestrator:        multiOrch,
        quarantineProcessor: processor,
        memoryIngester:      ingester,
      });

      // 6 calls → 2 clean, 2 quarantined-sanitized, 2 dropped
      for (let i = 0; i < 6; i++) {
        await pipeline.processIncomingPayload(rawPayload());
      }

      expect(pipeline.stats.totalProcessed).toBe(6);
      expect(pipeline.stats.totalClean).toBe(2);
      expect(pipeline.stats.totalQuarantined).toBe(2);
      expect(pipeline.stats.totalNeuralyzed).toBe(2);
    });
  });
});
