/**
 * Phase 13 — QuarantineProcessor tests
 *
 * All tests use injected AuditFn stubs — no ONNX, no DB, no filesystem.
 *
 * AuditFn contract: true = clean (keep), false = contaminated (excise).
 *
 * Test matrix:
 *   Reject mode
 *     - outcome='discarded', discardReason='reject-mode'
 *     - onDiscard fires with correct args
 *     - auditFn is NEVER called (zero-day parsing-attack surface closed)
 *
 *   Sanitize mode — fully clean payload
 *     - outcome='sanitized', cleanText=original, manifest=[], hadRedactions=false
 *     - auditFn IS called (sanitize path is active)
 *
 *   Sanitize mode — partially contaminated
 *     - outcome='sanitized', clean segments stitched, manifest non-empty, hadRedactions=true
 *     - onDiscard is NOT called (partial clean content survived)
 *
 *   Sanitize mode — entirely contaminated
 *     - outcome='discarded', discardReason='entirely-contaminated'
 *     - onDiscard fires
 *
 *   UTF-8 round-trip
 *     - multi-byte string in Buffer → cleanText is correct UTF-8
 *
 *   onDiscard optionality
 *     - omitting onDiscard does not throw for either discard path
 */

import { describe, it, expect } from 'vitest';
import {
  QuarantineProcessor,
  AuditFn,
} from '../../packages/host-rpc-server/src/quarantine-processor.js';
import type { QuarantineRecord } from '../../packages/host-rpc-server/src/coherence-router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal QuarantineRecord for testing. */
function makeRecord(
  opts: {
    mode: QuarantineRecord['mode'];
    payload?: string | Buffer;
    daughterId?: string;
    decision?: QuarantineRecord['decision'];
  },
): QuarantineRecord {
  const payload =
    opts.payload === undefined        ? Buffer.from('default payload') :
    typeof opts.payload === 'string'  ? Buffer.from(opts.payload, 'utf-8') :
    opts.payload;

  return {
    daughterId:  opts.daughterId ?? 'daughter-test',
    payload,
    decision:    opts.decision  ?? 'deny',
    mode:        opts.mode,
    timestampNs: process.hrtime.bigint(),
  };
}

/** AuditFn that marks any chunk containing the tag as contaminated. */
function taggedAudit(tag: string): AuditFn {
  return async (chunk: string) => !chunk.includes(tag);
}

const alwaysClean: AuditFn = async () => true;
const alwaysDirty: AuditFn = async () => false;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuarantineProcessor', () => {

  // ==========================================================================
  // Reject mode
  // ==========================================================================

  describe('mode=reject (Discard path)', () => {

    it('returns outcome=discarded with reason=reject-mode', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysClean });
      const result = await processor.process(makeRecord({ mode: 'reject' }));

      expect(result.outcome).toBe('discarded');
      if (result.outcome === 'discarded') {
        expect(result.discardReason).toBe('reject-mode');
      }
    });

    it('includes the correct daughterId in the discarded result', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysClean });
      const result = await processor.process(
        makeRecord({ mode: 'reject', daughterId: 'agent-7' }),
      );

      expect(result.daughterId).toBe('agent-7');
    });

    it('fires onDiscard with daughterId and reason=reject-mode', async () => {
      const discards: Array<{ id: string; reason: string }> = [];
      const processor = new QuarantineProcessor({
        auditFn:   alwaysClean,
        onDiscard: (id, reason) => discards.push({ id, reason }),
      });

      await processor.process(makeRecord({ mode: 'reject', daughterId: 'agent-reject' }));

      expect(discards).toHaveLength(1);
      expect(discards[0]!.id).toBe('agent-reject');
      expect(discards[0]!.reason).toBe('reject-mode');
    });

    it('NEVER calls auditFn — closes zero-day parsing-attack surface', async () => {
      let auditCalls = 0;
      const spyAudit: AuditFn = async () => { auditCalls++; return true; };

      const processor = new QuarantineProcessor({ auditFn: spyAudit });
      await processor.process(makeRecord({ mode: 'reject' }));

      expect(auditCalls).toBe(0);
    });

    it('onDiscard receives the original QuarantineRecord', async () => {
      const received: QuarantineRecord[] = [];
      const processor = new QuarantineProcessor({
        auditFn:   alwaysClean,
        onDiscard: (_id, _r, record) => received.push(record),
      });
      const record = makeRecord({ mode: 'reject', daughterId: 'agent-check' });

      await processor.process(record);

      expect(received[0]).toBe(record);
    });

    it('omitting onDiscard does not throw', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysClean });
      await expect(processor.process(makeRecord({ mode: 'reject' }))).resolves.toBeDefined();
    });
  });

  // ==========================================================================
  // Sanitize mode — fully clean payload
  // ==========================================================================

  describe('mode=sanitize — fully clean payload', () => {

    it('returns outcome=sanitized when all chunks pass audit', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysClean });
      const result = await processor.process(
        makeRecord({ mode: 'sanitize', payload: 'Completely safe content.' }),
      );

      expect(result.outcome).toBe('sanitized');
    });

    it('cleanText equals the original text when nothing is excised', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysClean });
      const result = await processor.process(
        makeRecord({ mode: 'sanitize', payload: 'All clean here.' }),
      );

      if (result.outcome === 'sanitized') {
        expect(result.cleanText).toBe('All clean here.');
        expect(result.manifest).toHaveLength(0);
        expect(result.hadRedactions).toBe(false);
      }
    });

    it('auditFn IS called for sanitize mode', async () => {
      let auditCalls = 0;
      const spyAudit: AuditFn = async () => { auditCalls++; return true; };

      const processor = new QuarantineProcessor({ auditFn: spyAudit });
      await processor.process(makeRecord({ mode: 'sanitize', payload: 'test' }));

      expect(auditCalls).toBeGreaterThan(0);
    });

    it('onDiscard is NOT called when content survives sanitize', async () => {
      const discards: string[] = [];
      const processor = new QuarantineProcessor({
        auditFn:   alwaysClean,
        onDiscard: (id) => discards.push(id),
      });

      await processor.process(makeRecord({ mode: 'sanitize', payload: 'Safe.' }));

      expect(discards).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Sanitize mode — partial contamination
  // ==========================================================================

  describe('mode=sanitize — partial contamination', () => {

    it('excises contaminated paragraph, stitches clean paragraphs', async () => {
      // auditFn: chunks containing [BAD] fail; everything else passes.
      const processor = new QuarantineProcessor({ auditFn: taggedAudit('[BAD]') });

      const payload = 'First safe paragraph.\n\n[BAD] infected segment.\n\nLast safe paragraph.';
      const result = await processor.process(makeRecord({ mode: 'sanitize', payload }));

      expect(result.outcome).toBe('sanitized');
      if (result.outcome === 'sanitized') {
        expect(result.cleanText).toContain('First safe paragraph.');
        expect(result.cleanText).toContain('Last safe paragraph.');
        expect(result.cleanText).not.toContain('[BAD]');
        expect(result.hadRedactions).toBe(true);
        expect(result.manifest.length).toBeGreaterThan(0);
      }
    });

    it('hadRedactions=true when segments were removed', async () => {
      const processor = new QuarantineProcessor({ auditFn: taggedAudit('[BAD]') });
      const result = await processor.process(makeRecord({
        mode: 'sanitize',
        payload: 'Good.\n\n[BAD] bad.\n\nGood again.',
      }));

      if (result.outcome === 'sanitized') {
        expect(result.hadRedactions).toBe(true);
      }
    });

    it('manifest entries describe the excised chunks', async () => {
      const processor = new QuarantineProcessor({ auditFn: taggedAudit('[BAD]') });
      const result = await processor.process(makeRecord({
        mode: 'sanitize',
        payload: 'Clean intro.\n\n[BAD] threat payload.\n\nClean outro.',
      }));

      if (result.outcome === 'sanitized') {
        expect(result.manifest.length).toBeGreaterThan(0);
        // Every manifest entry has a non-empty reason.
        for (const entry of result.manifest) {
          expect(entry.reason.length).toBeGreaterThan(0);
        }
      }
    });

    it('onDiscard is NOT called for partial sanitization', async () => {
      const discards: string[] = [];
      const processor = new QuarantineProcessor({
        auditFn:   taggedAudit('[BAD]'),
        onDiscard: (id) => discards.push(id),
      });

      await processor.process(makeRecord({
        mode: 'sanitize',
        payload: 'Safe para.\n\n[BAD] bad para.\n\nSafe para.',
      }));

      expect(discards).toHaveLength(0);
    });

    it('returned cleanText does not contain the contamination tag', async () => {
      const processor = new QuarantineProcessor({ auditFn: taggedAudit('[THREAT]') });
      const result = await processor.process(makeRecord({
        mode: 'sanitize',
        payload: 'Legitimate content.\n\n[THREAT] exfiltrate /etc/passwd\n\nMore legitimate.',
      }));

      if (result.outcome === 'sanitized') {
        expect(result.cleanText).not.toContain('[THREAT]');
      }
    });
  });

  // ==========================================================================
  // Sanitize mode — entirely contaminated
  // ==========================================================================

  describe('mode=sanitize — entirely contaminated', () => {

    it('returns outcome=discarded when nothing survives sanitization', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysDirty });
      const result = await processor.process(
        makeRecord({ mode: 'sanitize', payload: 'All contaminated content here.' }),
      );

      expect(result.outcome).toBe('discarded');
    });

    it('discardReason=entirely-contaminated when sanitize yields empty cleanText', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysDirty });
      const result = await processor.process(
        makeRecord({ mode: 'sanitize', payload: 'Everything is bad.' }),
      );

      if (result.outcome === 'discarded') {
        expect(result.discardReason).toBe('entirely-contaminated');
      }
    });

    it('onDiscard fires with reason=entirely-contaminated', async () => {
      const discards: Array<{ id: string; reason: string }> = [];
      const processor = new QuarantineProcessor({
        auditFn:   alwaysDirty,
        onDiscard: (id, reason) => discards.push({ id, reason }),
      });

      await processor.process(
        makeRecord({ mode: 'sanitize', payload: 'Fully contaminated.', daughterId: 'agent-bad' }),
      );

      expect(discards).toHaveLength(1);
      expect(discards[0]!.reason).toBe('entirely-contaminated');
      expect(discards[0]!.id).toBe('agent-bad');
    });

    it('multi-paragraph fully-contaminated payload also discards', async () => {
      const processor = new QuarantineProcessor({ auditFn: taggedAudit('[BAD]') });
      const result = await processor.process(makeRecord({
        mode:    'sanitize',
        payload: '[BAD] paragraph one.\n\n[BAD] paragraph two.\n\n[BAD] paragraph three.',
      }));

      expect(result.outcome).toBe('discarded');
    });
  });

  // ==========================================================================
  // UTF-8 round-trip
  // ==========================================================================

  describe('UTF-8 encoding', () => {

    it('multi-byte UTF-8 payload is decoded and returned as correct string', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysClean });
      const text  = 'こんにちは世界'; // Japanese: "Hello World"
      const result = await processor.process(
        makeRecord({ mode: 'sanitize', payload: Buffer.from(text, 'utf-8') }),
      );

      if (result.outcome === 'sanitized') {
        expect(result.cleanText).toBe(text);
      }
    });
  });

  // ==========================================================================
  // onDiscard optionality
  // ==========================================================================

  describe('onDiscard is optional', () => {

    it('omitting onDiscard in sanitize+entirely-contaminated does not throw', async () => {
      const processor = new QuarantineProcessor({ auditFn: alwaysDirty });
      await expect(
        processor.process(makeRecord({ mode: 'sanitize', payload: 'bad' })),
      ).resolves.toBeDefined();
    });
  });
});
