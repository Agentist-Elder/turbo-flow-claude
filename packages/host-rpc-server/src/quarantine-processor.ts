/**
 * Phase 13 — Quarantine Processor (Deep Decontamination)
 *
 * Bridges the Phase 11 CoherenceRouter's quarantine stream and the
 * Phase 21 SemanticChunker.  Receives a QuarantineRecord and applies
 * the QuarantineMode policy:
 *
 *   mode='reject'   → DISCARD immediately, no semantic analysis.
 *                     The payload is never fed to the chunker — this
 *                     closes the zero-day parsing-attack vector where a
 *                     crafted payload could exploit the chunker itself.
 *
 *   mode='sanitize' → SANITIZE via SemanticChunker.decontaminate().
 *                     Clean segments are stitched back together and
 *                     returned as safe downstream-embedding content.
 *                     If every segment is contaminated, the result is
 *                     DISCARDED (not returned as an empty string).
 *
 * Dependency injection:
 *   AuditFn is the only required dependency.  In production this wraps
 *   makeSemanticAuditFn() from main.ts (ONNX + vector DB).  In tests
 *   it is a simple stub — no ONNX, no DB, no filesystem.
 *
 * Logging:
 *   The processor holds no I/O; discards are reported via the optional
 *   onDiscard callback so the caller controls logging/persistence.
 */

import { decontaminate } from '../../../src/security/semantic-chunker.js';
import type { AuditFn, ManifestEntry } from '../../../src/security/semantic-chunker.js';
import type { QuarantineRecord } from './coherence-router.js';

// Re-export so callers only need to import from this module.
export type { AuditFn, ManifestEntry };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** The two possible outcomes of processing a quarantined payload. */
export type ProcessorOutcome = 'discarded' | 'sanitized';

export type ProcessorResult =
  | {
      outcome: 'discarded';
      daughterId: string;
      /**
       * 'reject-mode'          — payload dropped due to QuarantineMode='reject'.
       * 'entirely-contaminated' — sanitize mode ran but all segments were excised.
       */
      discardReason: 'reject-mode' | 'entirely-contaminated';
    }
  | {
      outcome: 'sanitized';
      daughterId: string;
      /** UTF-8 clean text, verified segments stitched back together. */
      cleanText: string;
      /** Audit trail of excised segments from the SemanticChunker. */
      manifest: ManifestEntry[];
      /** True when at least one segment was excised (partial contamination). */
      hadRedactions: boolean;
    };

export interface QuarantineProcessorConfig {
  /**
   * Semantic audit function.
   * Returns true (clean / keep) or false (contaminated / excise).
   *
   * In production: wraps makeSemanticAuditFn() which uses ONNX + vector DB.
   * In tests:      a simple stub, e.g. async (chunk) => !chunk.includes('[BAD]').
   */
  auditFn: AuditFn;

  /**
   * Optional. Called every time a payload is discarded, regardless of mode.
   * The processor does not write to stdout/filesystem; all logging is external.
   *
   * @param daughterId    ID of the Daughter whose payload was discarded.
   * @param reason        Why it was discarded (reject-mode or entirely-contaminated).
   * @param record        Original QuarantineRecord (payload included for audit trail).
   */
  onDiscard?: (
    daughterId: string,
    reason: 'reject-mode' | 'entirely-contaminated',
    record: QuarantineRecord,
  ) => void;
}

// ---------------------------------------------------------------------------
// QuarantineProcessor
// ---------------------------------------------------------------------------

/**
 * QuarantineProcessor — The Deep Decontaminator.
 *
 * Instantiate with new QuarantineProcessor(config).
 * Call process(record) for each quarantined payload from the Phase 11 router.
 */
export class QuarantineProcessor {
  private readonly auditFn: AuditFn;
  private readonly onDiscard: QuarantineProcessorConfig['onDiscard'];

  constructor(config: QuarantineProcessorConfig) {
    this.auditFn   = config.auditFn;
    this.onDiscard = config.onDiscard;
  }

  /**
   * Process a quarantined payload according to its QuarantineMode.
   *
   * @param record  QuarantineRecord from CoherenceRouter (Phase 11).
   * @returns       ProcessorResult — either discarded or sanitized.
   */
  async process(record: QuarantineRecord): Promise<ProcessorResult> {
    // -----------------------------------------------------------------------
    // REJECT mode: hard discard — do not pass payload to the chunker.
    //
    // Feeding an adversarially crafted payload to the semantic chunker
    // (even in a parse-only operation) is a surface that a zero-day
    // parser exploit could abuse.  Reject mode eliminates this surface.
    // -----------------------------------------------------------------------
    if (record.mode === 'reject') {
      const reason = 'reject-mode' as const;
      this.onDiscard?.(record.daughterId, reason, record);
      return { outcome: 'discarded', daughterId: record.daughterId, discardReason: reason };
    }

    // -----------------------------------------------------------------------
    // SANITIZE mode: decode → decontaminate → reconstruct.
    // -----------------------------------------------------------------------
    const text   = record.payload.toString('utf-8');
    const result = await decontaminate(text, this.auditFn);

    // If every segment was contaminated the cleanText is empty.
    // Return as discarded rather than handing an empty string downstream.
    if (result.cleanText.length === 0) {
      const reason = 'entirely-contaminated' as const;
      this.onDiscard?.(record.daughterId, reason, record);
      return { outcome: 'discarded', daughterId: record.daughterId, discardReason: reason };
    }

    return {
      outcome:       'sanitized',
      daughterId:    record.daughterId,
      cleanText:     result.cleanText,
      manifest:      result.manifest,
      hadRedactions: result.manifest.length > 0,
    };
  }
}
