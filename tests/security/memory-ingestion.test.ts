/**
 * Phase 14 — MemoryIngester tests
 *
 * All tests use an injected IVectorStore spy — no ruvector-mem, no ONNX,
 * no network, no filesystem.
 *
 * Test matrix:
 *   Chunking
 *     - Single-paragraph text → 1 chunk stored
 *     - Multi-paragraph text  → N chunks, one per paragraph
 *     - Chunks below minChunkLength are skipped
 *     - Custom minChunkLength respected
 *     - Empty / whitespace-only text → 0 chunks stored
 *
 *   Chunk metadata correctness
 *     - All chunks share the same documentId
 *     - chunkIndex is sequential (0, 1, 2, …)
 *     - totalChunks is correct for every chunk
 *     - daughterId propagated to every chunk
 *     - source propagated to every chunk
 *     - originUrl propagated (when provided)
 *     - timestamp propagated (or defaulted)
 *
 *   IVectorStore interaction
 *     - store.add called once per valid chunk
 *     - text passed to store.add matches the split chunk
 *     - chunk IDs returned by store are surfaced in IngestionResult
 *
 *   IngestionResult
 *     - chunksStored matches chunkIds.length
 *     - documentId is a non-empty string
 *     - documentId is consistent across chunks in the same call
 *     - Two ingest() calls produce different documentIds
 *
 *   Source tagging
 *     - 'clean-stream' source is preserved
 *     - 'sanitized'    source is preserved
 *
 *   Timestamp default
 *     - Omitting timestamp produces an ISO 8601 string
 */

import { describe, it, expect } from 'vitest';
import {
  MemoryIngester,
  IVectorStore,
  ChunkMetadata,
  DocumentMetadata,
} from '../../packages/host-rpc-server/src/memory-ingestion.js';

// ---------------------------------------------------------------------------
// Mock vector store factory
// ---------------------------------------------------------------------------

interface StoreCall {
  text:     string;
  metadata: ChunkMetadata;
}

function makeStore(idPrefix = 'chunk'): { store: IVectorStore; calls: StoreCall[] } {
  const calls: StoreCall[] = [];
  let counter = 0;

  const store: IVectorStore = {
    add: async (text: string, metadata: ChunkMetadata): Promise<string> => {
      calls.push({ text, metadata });
      return `${idPrefix}-${counter++}`;
    },
  };

  return { store, calls };
}

// ---------------------------------------------------------------------------
// Default metadata helper
// ---------------------------------------------------------------------------

function meta(overrides: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return {
    daughterId: 'daughter-default',
    source:     'clean-stream',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MemoryIngester', () => {

  // ==========================================================================
  // Chunking — split strategy
  // ==========================================================================

  describe('chunking', () => {

    it('single-paragraph text is stored as 1 chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('A single clean paragraph.', meta());

      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toBe('A single clean paragraph.');
    });

    it('two-paragraph text produces 2 chunks', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('First paragraph.\n\nSecond paragraph.', meta());

      expect(calls).toHaveLength(2);
      expect(calls[0]!.text).toBe('First paragraph.');
      expect(calls[1]!.text).toBe('Second paragraph.');
    });

    it('three-paragraph text produces 3 chunks in order', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.', meta());

      expect(calls).toHaveLength(3);
      expect(calls[0]!.text).toBe('First paragraph here.');
      expect(calls[1]!.text).toBe('Second paragraph here.');
      expect(calls[2]!.text).toBe('Third paragraph here.');
    });

    it('chunks below default minChunkLength (10) are skipped', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store }); // default minChunkLength=10

      // "Hi" (2 chars) should be skipped; the longer paragraph should be stored.
      await ingester.ingest('Hi\n\nThis is a long enough paragraph.', meta());

      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toBe('This is a long enough paragraph.');
    });

    it('custom minChunkLength=0 stores all non-empty chunks', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store, minChunkLength: 0 });

      await ingester.ingest('Hi\n\nLonger paragraph here.', meta());

      expect(calls).toHaveLength(2);
    });

    it('custom minChunkLength=50 skips chunks shorter than 50 chars', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store, minChunkLength: 50 });

      const short = 'Short.';             // 6 chars — skipped
      const long  = 'This paragraph is definitely longer than fifty characters in total.'; // 67 chars — stored
      await ingester.ingest(`${short}\n\n${long}`, meta());

      expect(calls).toHaveLength(1);
      expect(calls[0]!.text).toBe(long);
    });

    it('empty text stores 0 chunks', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      const result = await ingester.ingest('', meta());

      expect(calls).toHaveLength(0);
      expect(result.chunksStored).toBe(0);
      expect(result.chunkIds).toHaveLength(0);
    });

    it('whitespace-only text stores 0 chunks', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      const result = await ingester.ingest('   \n\n   \n   ', meta());

      expect(calls).toHaveLength(0);
      expect(result.chunksStored).toBe(0);
    });
  });

  // ==========================================================================
  // Chunk metadata correctness
  // ==========================================================================

  describe('chunk metadata', () => {

    it('all chunks share the same documentId', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph here.', meta());

      const ids = calls.map(c => c.metadata.documentId);
      expect(new Set(ids).size).toBe(1); // all identical
    });

    it('chunkIndex is sequential starting at 0', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('Alpha here.\n\nBeta here.\n\nGamma here.\n\nDelta here.', meta());

      expect(calls.map(c => c.metadata.chunkIndex)).toEqual([0, 1, 2, 3]);
    });

    it('totalChunks is correct for every chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('Alpha chunk.\n\nBeta chunk.\n\nGamma chunk.', meta());

      for (const call of calls) {
        expect(call.metadata.totalChunks).toBe(3);
      }
    });

    it('daughterId is propagated to every chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('First paragraph here.\n\nSecond paragraph here.', meta({ daughterId: 'agent-42' }));

      for (const call of calls) {
        expect(call.metadata.daughterId).toBe('agent-42');
      }
    });

    it('source=clean-stream is propagated to every chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('Clean content here.', meta({ source: 'clean-stream' }));

      expect(calls[0]!.metadata.source).toBe('clean-stream');
    });

    it('source=sanitized is propagated to every chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('Sanitized content here.', meta({ source: 'sanitized' }));

      expect(calls[0]!.metadata.source).toBe('sanitized');
    });

    it('originUrl is propagated to every chunk when provided', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest(
        'First paragraph here.\n\nSecond paragraph here.',
        meta({ originUrl: 'https://example.com/article' }),
      );

      for (const call of calls) {
        expect(call.metadata.originUrl).toBe('https://example.com/article');
      }
    });

    it('explicit timestamp is propagated to every chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });
      const ts = '2026-03-02T00:00:00.000Z';

      await ingester.ingest('Content here.', meta({ timestamp: ts }));

      expect(calls[0]!.metadata.timestamp).toBe(ts);
    });

    it('omitting timestamp defaults to a valid ISO 8601 string', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('Content here.', meta()); // no timestamp

      const ts = calls[0]!.metadata.timestamp;
      expect(ts).toBeTruthy();
      expect(() => new Date(ts).toISOString()).not.toThrow();
    });

    it('defaulted timestamp is the same for all chunks in one ingest call', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('First chunk.\n\nSecond chunk.\n\nThird chunk.', meta());

      const timestamps = calls.map(c => c.metadata.timestamp);
      expect(new Set(timestamps).size).toBe(1);
    });
  });

  // ==========================================================================
  // IVectorStore interaction
  // ==========================================================================

  describe('IVectorStore interaction', () => {

    it('store.add is called exactly once per valid chunk', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('First chunk here.\n\nSecond chunk here.\n\nThird chunk here.', meta());

      expect(calls).toHaveLength(3);
    });

    it('text passed to store.add matches the split chunk content', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      await ingester.ingest('Hello world.\n\nGoodbye world.', meta());

      expect(calls[0]!.text).toBe('Hello world.');
      expect(calls[1]!.text).toBe('Goodbye world.');
    });

    it('chunk IDs returned by store appear in IngestionResult.chunkIds', async () => {
      const { store } = makeStore('vec');
      const ingester  = new MemoryIngester({ store });

      const result = await ingester.ingest('First paragraph here.\n\nSecond paragraph here.', meta());

      expect(result.chunkIds).toEqual(['vec-0', 'vec-1']);
    });
  });

  // ==========================================================================
  // IngestionResult
  // ==========================================================================

  describe('IngestionResult', () => {

    it('chunksStored matches chunkIds.length', async () => {
      const { store } = makeStore();
      const ingester  = new MemoryIngester({ store });

      const result = await ingester.ingest('Alpha chunk.\n\nBeta chunk.\n\nGamma chunk.', meta());

      expect(result.chunksStored).toBe(result.chunkIds.length);
    });

    it('documentId is a non-empty string', async () => {
      const { store } = makeStore();
      const ingester  = new MemoryIngester({ store });

      const result = await ingester.ingest('Content here.', meta());

      expect(typeof result.documentId).toBe('string');
      expect(result.documentId.length).toBeGreaterThan(0);
    });

    it('documentId in result matches documentId in chunk metadata', async () => {
      const { store, calls } = makeStore();
      const ingester = new MemoryIngester({ store });

      const result = await ingester.ingest('First chunk.\n\nSecond chunk.', meta());

      for (const call of calls) {
        expect(call.metadata.documentId).toBe(result.documentId);
      }
    });

    it('two separate ingest() calls produce different documentIds', async () => {
      const { store } = makeStore();
      const ingester  = new MemoryIngester({ store });

      const r1 = await ingester.ingest('Document one.', meta());
      const r2 = await ingester.ingest('Document two.', meta());

      expect(r1.documentId).not.toBe(r2.documentId);
    });

    it('result.metadata reflects the resolved document metadata', async () => {
      const { store } = makeStore();
      const ingester  = new MemoryIngester({ store });

      const result = await ingester.ingest('Content here.', meta({
        daughterId: 'agent-99',
        source:     'sanitized',
        originUrl:  'https://example.com',
      }));

      expect(result.metadata.daughterId).toBe('agent-99');
      expect(result.metadata.source).toBe('sanitized');
      expect(result.metadata.originUrl).toBe('https://example.com');
    });

    it('chunksStored is 0 for empty input', async () => {
      const { store } = makeStore();
      const ingester  = new MemoryIngester({ store });

      const result = await ingester.ingest('', meta());

      expect(result.chunksStored).toBe(0);
      expect(result.chunkIds).toHaveLength(0);
    });
  });
});
