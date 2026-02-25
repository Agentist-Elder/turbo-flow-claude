/**
 * Unit tests for semantic-chunker.ts — Phase 21 pure logic.
 *
 * No DB, ONNX, or filesystem access.
 * All audit decisions are injected via vi.fn() stubs.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  splitIntoParagraphs,
  splitIntoSentences,
  splitAtDepth,
  joinAtDepth,
  decontaminate,
  MAX_DEPTH,
  type AuditFn,
} from '../../src/security/semantic-chunker.js';

// ── splitIntoParagraphs ───────────────────────────────────────────────────────

describe('splitIntoParagraphs', () => {
  it('splits on double newline', () => {
    expect(splitIntoParagraphs('Hello\n\nWorld')).toEqual(['Hello', 'World']);
  });

  it('splits on single newline', () => {
    expect(splitIntoParagraphs('A\nB\nC')).toEqual(['A', 'B', 'C']);
  });

  it('strips empty segments', () => {
    expect(splitIntoParagraphs('A\n\n\n\nB')).toEqual(['A', 'B']);
  });

  it('trims whitespace-only lines', () => {
    expect(splitIntoParagraphs('  Hello  \n\n  World  ')).toEqual(['Hello', 'World']);
  });

  it('returns empty array for blank input', () => {
    expect(splitIntoParagraphs('   \n\n   ')).toEqual([]);
  });

  it('returns single element for text with no newlines', () => {
    expect(splitIntoParagraphs('no newlines here')).toEqual(['no newlines here']);
  });
});

// ── splitIntoSentences ────────────────────────────────────────────────────────

describe('splitIntoSentences', () => {
  it('splits on period + space', () => {
    expect(splitIntoSentences('Hello world. Foo bar.')).toEqual(['Hello world.', 'Foo bar.']);
  });

  it('splits on question mark + space', () => {
    expect(splitIntoSentences('Is this safe? Yes it is.')).toEqual(['Is this safe?', 'Yes it is.']);
  });

  it('splits on exclamation mark + space', () => {
    expect(splitIntoSentences('Alert! Take action now.')).toEqual(['Alert!', 'Take action now.']);
  });

  it('returns single element for text with no sentence boundary', () => {
    expect(splitIntoSentences('no punctuation here')).toEqual(['no punctuation here']);
  });

  it('strips empty segments', () => {
    const result = splitIntoSentences('Hello.   World.');
    expect(result.every(s => s.length > 0)).toBe(true);
  });
});

// ── splitAtDepth / joinAtDepth ────────────────────────────────────────────────

describe('splitAtDepth', () => {
  it('depth 0 → paragraph split', () => {
    expect(splitAtDepth('A\n\nB', 0)).toEqual(['A', 'B']);
  });

  it('depth 1 → sentence split', () => {
    expect(splitAtDepth('Hello. World.', 1)).toEqual(['Hello.', 'World.']);
  });

  it('depth 2 → sentence split (same as depth 1)', () => {
    expect(splitAtDepth('Hello. World.', 2)).toEqual(['Hello.', 'World.']);
  });
});

describe('joinAtDepth', () => {
  it('depth 0 → double newline join', () => {
    expect(joinAtDepth(['A', 'B'], 0)).toBe('A\n\nB');
  });

  it('depth 1 → space join', () => {
    expect(joinAtDepth(['Hello.', 'World.'], 1)).toBe('Hello. World.');
  });
});

// ── MAX_DEPTH constant ────────────────────────────────────────────────────────

describe('MAX_DEPTH', () => {
  it('is 4', () => {
    expect(MAX_DEPTH).toBe(4);
  });
});

// ── decontaminate — fast path ─────────────────────────────────────────────────

describe('decontaminate — fast path (text passes top-level audit)', () => {
  it('returns isClean:true and original text unchanged', async () => {
    const auditFn: AuditFn = vi.fn().mockResolvedValue(true);
    const result = await decontaminate('clean text', auditFn);

    expect(result.isClean).toBe(true);
    expect(result.cleanText).toBe('clean text');
    expect(result.manifest).toHaveLength(0);
  });

  it('calls auditFn exactly once on fast path', async () => {
    const auditFn: AuditFn = vi.fn().mockResolvedValue(true);
    await decontaminate('clean text', auditFn);

    expect(auditFn).toHaveBeenCalledTimes(1);
  });
});

// ── decontaminate — all-dirty single paragraph ───────────────────────────────

describe('decontaminate — entirely contaminated single paragraph', () => {
  it('redacts the whole chunk when it cannot be split at any depth', async () => {
    // A single sentence — paragraph split returns 1 piece, sentence split returns 1 piece.
    // Recursion will hit MAX_DEPTH and redact.
    const auditFn: AuditFn = vi.fn().mockResolvedValue(false);
    const result = await decontaminate('This single sentence is dirty.', auditFn);

    expect(result.isClean).toBe(false);
    expect(result.cleanText).toBe('');
    expect(result.manifest.length).toBeGreaterThan(0);
  });

  it('manifest entry contains the redacted text', async () => {
    const input = 'This single sentence is dirty.';
    const auditFn: AuditFn = vi.fn().mockResolvedValue(false);
    const result = await decontaminate(input, auditFn);

    const allRedacted = result.manifest.flatMap(e => e.redactedChunks);
    expect(allRedacted.some(s => s.includes('dirty'))).toBe(true);
  });
});

// ── decontaminate — partial contamination at paragraph level ─────────────────

describe('decontaminate — one dirty paragraph among clean ones', () => {
  it('removes only the dirty paragraph and keeps clean ones', async () => {
    const dirty = 'ATTACK PAYLOAD HERE';
    const text = `Good intro paragraph.\n\n${dirty}\n\nGood conclusion paragraph.`;

    // Top-level: dirty. Paragraphs: first=clean, second=dirty, third=clean.
    const auditFn: AuditFn = vi.fn(async (chunk: string) => {
      if (chunk === text) return false;       // top level fails
      if (chunk === dirty) return false;      // dirty paragraph fails
      return true;                            // all others pass
    });

    const result = await decontaminate(text, auditFn);

    expect(result.isClean).toBe(false);
    expect(result.cleanText).toContain('Good intro paragraph.');
    expect(result.cleanText).toContain('Good conclusion paragraph.');
    expect(result.cleanText).not.toContain(dirty);
  });

  it('manifest records the redacted paragraph', async () => {
    const dirty = 'ATTACK PAYLOAD HERE';
    const text = `Clean.\n\n${dirty}\n\nAlso clean.`;

    const auditFn: AuditFn = vi.fn(async (chunk: string) => {
      return chunk !== text && chunk !== dirty;
    });

    const result = await decontaminate(text, auditFn);
    const allRedacted = result.manifest.flatMap(e => e.redactedChunks);

    expect(allRedacted).toContain(dirty);
  });
});

// ── decontaminate — partial contamination at sentence level ──────────────────

describe('decontaminate — one dirty sentence inside a dirty paragraph', () => {
  it('removes only the dirty sentence and keeps the clean sentence', async () => {
    const dirtyParagraph = 'This sentence is clean. EVIL INJECTION. Back to normal.';
    const text = `Preamble.\n\n${dirtyParagraph}`;

    const auditFn: AuditFn = vi.fn(async (chunk: string) => {
      if (chunk === text) return false;              // top level fails
      if (chunk === dirtyParagraph) return false;    // paragraph fails
      if (chunk === 'EVIL INJECTION.') return false; // sentence fails
      return true;
    });

    const result = await decontaminate(text, auditFn);

    expect(result.cleanText).toContain('This sentence is clean.');
    expect(result.cleanText).toContain('Back to normal.');
    expect(result.cleanText).not.toContain('EVIL INJECTION');
  });
});

// ── decontaminate — MAX_DEPTH enforcement ────────────────────────────────────

describe('decontaminate — MAX_DEPTH enforcement', () => {
  it('redacts chunk when audit always returns false regardless of depth', async () => {
    // Multi-paragraph, multi-sentence — but auditFn always returns false.
    // Should eventually hit MAX_DEPTH and redact, not loop forever.
    const text = 'Para one sentence one. Para one sentence two.\n\nPara two sentence one.';
    const auditFn: AuditFn = vi.fn().mockResolvedValue(false);

    const result = await decontaminate(text, auditFn);

    expect(result.isClean).toBe(false);
    expect(result.cleanText).toBe('');
    // Must terminate — if this test completes, MAX_DEPTH worked
  });

  it('manifest reason mentions MAX_DEPTH when limit is reached', async () => {
    const text = 'Always dirty content.';
    const auditFn: AuditFn = vi.fn().mockResolvedValue(false);

    const result = await decontaminate(text, auditFn);
    const reasons = result.manifest.map(e => e.reason);

    expect(reasons.some(r => r.includes('MAX_DEPTH'))).toBe(true);
  });
});

// ── decontaminate — call budget ───────────────────────────────────────────────

describe('decontaminate — auditFn call count is bounded', () => {
  it('calls auditFn a bounded number of times on a multi-paragraph dirty document', async () => {
    // Two paragraphs, each with two sentences, all dirty.
    const text = 'Sentence one. Sentence two.\n\nSentence three. Sentence four.';
    const auditFn: AuditFn = vi.fn().mockResolvedValue(false);

    await decontaminate(text, auditFn);

    // MAX_DEPTH=4 → worst case bounded, not exponential
    // Actual call count depends on split structure; just verify it terminates
    // and stays well under an absurd cap.
    expect((auditFn as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThan(50);
  });
});
