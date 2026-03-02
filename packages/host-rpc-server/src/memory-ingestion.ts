/**
 * Phase 14 — Memory Ingestion Pipeline (The Vault Archivist)
 *
 * Accepts verified clean text — either from the RC_ALLOW clean stream
 * (Phase 11 router) or from the Phase 13 QuarantineProcessor's sanitized
 * output — and stores it in the vector database via the IVectorStore interface.
 *
 * Pipeline:
 *   1. Split text into storage chunks (paragraph-level semantic chunking).
 *   2. Assign document-level metadata (documentId, source, daughterId, …).
 *   3. For each chunk: call IVectorStore.add(text, chunkMetadata) → chunk ID.
 *   4. Return IngestionResult summarising the stored document.
 *
 * This chunking is distinct from the Phase 21 Surgeon's security chunking:
 *   Phase 21 chunking → decontamination (find and excise toxic segments).
 *   Phase 14 chunking → storage optimisation (logical units for embedding).
 *
 * IVectorStore is injected so tests can mock the embedding + storage layer
 * without touching ruvector-mem, ONNX, or any network calls.
 */

import { randomUUID } from 'node:crypto';
import { splitIntoParagraphs } from '../../../src/security/semantic-chunker.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Where the clean text originated.
 * 'clean-stream'  — passed the WASM gate with RC_ALLOW.
 * 'sanitized'     — was quarantined but partially cleaned by Phase 13.
 */
export type IngestionSource = 'clean-stream' | 'sanitized';

/** Document-level metadata supplied by the caller. */
export interface DocumentMetadata {
  /** ID of the Daughter agent that produced the content. */
  daughterId: string;
  /**
   * ISO 8601 ingestion timestamp.
   * Defaults to the current wall-clock time if omitted.
   */
  timestamp?: string;
  /** Whether this came from the clean stream or the decontamination pipeline. */
  source: IngestionSource;
  /** Optional origin URL (web-fetch source, tool result, etc.). */
  originUrl?: string;
}

/**
 * Per-chunk metadata stored alongside each vector in the database.
 * Extends DocumentMetadata with the document and positional context.
 */
export interface ChunkMetadata extends Required<Pick<DocumentMetadata, 'timestamp'>> {
  daughterId:  string;
  source:      IngestionSource;
  originUrl?:  string;
  /** UUID tying all chunks of the same document together. */
  documentId:  string;
  /** Zero-based position of this chunk within the document. */
  chunkIndex:  number;
  /** Total number of chunks the document was split into. */
  totalChunks: number;
}

/** Returned by MemoryIngester.ingest() after all chunks are stored. */
export interface IngestionResult {
  /** UUID assigned to this document. */
  documentId: string;
  /** Number of chunks actually stored (may differ from raw split count if short chunks were skipped). */
  chunksStored: number;
  /** Vector-store IDs returned for each stored chunk, in order. */
  chunkIds: string[];
  /** Original document-level metadata (with timestamp resolved). */
  metadata: Required<DocumentMetadata>;
}

// ---------------------------------------------------------------------------
// IVectorStore — injectable embedding + storage abstraction
// ---------------------------------------------------------------------------

/**
 * Abstraction over the vector embedding and storage backend.
 *
 * Production implementation: wraps ruvector-mem, calls embed() then upsert().
 * Test implementation:       spy that records calls and returns predictable IDs.
 *
 * @param text      Raw chunk text to embed and store.
 * @param metadata  Per-chunk metadata to persist alongside the vector.
 * @returns         The unique ID assigned to the stored vector record.
 */
export interface IVectorStore {
  add(text: string, metadata: ChunkMetadata): Promise<string>;
}

// ---------------------------------------------------------------------------
// IngesterConfig
// ---------------------------------------------------------------------------

export interface IngesterConfig {
  /** Injected vector store (mock in tests, ruvector-mem in production). */
  store: IVectorStore;

  /**
   * Minimum character length for a chunk to be stored.
   * Chunks shorter than this threshold are silently skipped.
   * Default: 10.  Prevents near-empty paragraphs from polluting the DB.
   */
  minChunkLength?: number;
}

// ---------------------------------------------------------------------------
// MemoryIngester
// ---------------------------------------------------------------------------

/**
 * MemoryIngester — The Vault Archivist.
 *
 * Stateless beyond config; safe to share across concurrent callers.
 */
export class MemoryIngester {
  private readonly store: IVectorStore;
  private readonly minChunkLength: number;

  constructor(config: IngesterConfig) {
    this.store          = config.store;
    this.minChunkLength = config.minChunkLength ?? 10;
  }

  /**
   * Ingest a clean text document into the vector database.
   *
   * @param text      Verified clean UTF-8 text (from RC_ALLOW stream or Phase 13).
   * @param metadata  Document-level metadata to associate with every chunk.
   * @returns         IngestionResult with documentId, chunk count, and chunk IDs.
   */
  async ingest(text: string, metadata: DocumentMetadata): Promise<IngestionResult> {
    const documentId  = randomUUID();
    const timestamp   = metadata.timestamp ?? new Date().toISOString();

    // Resolved metadata (timestamp guaranteed present).
    const resolvedMeta: Required<DocumentMetadata> = {
      daughterId: metadata.daughterId,
      timestamp,
      source:     metadata.source,
      originUrl:  metadata.originUrl ?? '',
    };

    // Split into paragraph-level chunks and filter trivially short segments.
    const rawChunks  = splitIntoParagraphs(text);
    const chunks     = rawChunks.filter(c => c.length >= this.minChunkLength);
    const totalChunks = chunks.length;

    const chunkIds: string[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const chunkMeta: ChunkMetadata = {
        daughterId:  resolvedMeta.daughterId,
        timestamp,
        source:      resolvedMeta.source,
        originUrl:   resolvedMeta.originUrl || undefined,
        documentId,
        chunkIndex:  i,
        totalChunks,
      };

      const id = await this.store.add(chunks[i]!, chunkMeta);
      chunkIds.push(id);
    }

    return {
      documentId,
      chunksStored: chunkIds.length,
      chunkIds,
      metadata: resolvedMeta,
    };
  }
}
