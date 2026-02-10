import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIDefenceCoordinator, MockMCPClient, ThreatLevel } from '../../src/security/coordinator.js';
import { normalizeInput, textToVector } from '../../src/security/vector-scanner.js';
import { AdaptiveLearner } from '../../src/security/adaptive-learner.js';

describe('Auditor: L3 fail-CLOSED invariant', () => {
  // Ref: AUD-3 (coordinator.ts:L256-284)

  let mockMCP: any;

  beforeEach(() => {
    mockMCP = {
      scanInput: vi.fn().mockResolvedValue({ threat_detected: false, score: 0, matched_patterns: [] }),
      analyzeThreats: vi.fn().mockResolvedValue({ classification: 'informational', confidence: 0, vector_matches: 0, dtw_score: 1.0 }),
      checkSafety: vi.fn().mockRejectedValue(new Error('L3 internal failure')),
      detectPII: vi.fn().mockResolvedValue({ has_pii: false, entities_found: [], redacted_text: '' }),
      learn: vi.fn().mockResolvedValue(undefined),
      recordStats: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('should BLOCK when checkSafety throws', async () => {
    const coordinator = new AIDefenceCoordinator({}, mockMCP);
    const result = await coordinator.processRequest('test input');

    expect(result.is_blocked).toBe(true);
    expect(result.verdict).toBe(ThreatLevel.BLOCKED);
  });

  it('should set block_reason to "Safety gate internal error"', async () => {
    const coordinator = new AIDefenceCoordinator({}, mockMCP);
    const result = await coordinator.processRequest('test input');

    expect(result.block_reason).toBe('Safety gate internal error');
  });
});

describe('Auditor: Latency SLA', () => {
  // Ref: AUD-2 (coordinator.ts:L86-92)

  it('fast path must complete within 16ms', async () => {
    const cleanMCP = new MockMCPClient();
    const coordinator = new AIDefenceCoordinator({}, cleanMCP);

    const result = await coordinator.processRequest('clean input');

    expect(result.total_latency_ms).toBeLessThan(16);
  });

  it('layer_timings should have keys L1_SCAN, L2_ANALYZE, L3_SAFE, L4_PII', async () => {
    const cleanMCP = new MockMCPClient();
    const coordinator = new AIDefenceCoordinator({}, cleanMCP);

    const result = await coordinator.processRequest('clean input');

    expect(result.layer_timings).toHaveProperty('L1_SCAN');
    expect(result.layer_timings).toHaveProperty('L2_ANALYZE');
    expect(result.layer_timings).toHaveProperty('L3_SAFE');
    expect(result.layer_timings).toHaveProperty('L4_PII');
  });
});

describe('Auditor: Adaptive learning loop', () => {
  // Ref: AUD-11 (adaptive-learner.ts:L86-133)

  let mockExplorer: any;
  let mockReviewer: any;
  let mockScanner: any;
  let learner: AdaptiveLearner;

  beforeEach(() => {
    mockExplorer = {
      findNearMisses: vi.fn()
    };
    mockReviewer = {
      review: vi.fn()
    };
    mockScanner = {
      normalizeInput: vi.fn(s => s.toLowerCase()),
      textToVector: vi.fn(() => new Array(384).fill(0)),
      insertPattern: vi.fn().mockResolvedValue(undefined)
    };

    learner = new AdaptiveLearner(mockScanner, mockExplorer, mockReviewer);
  });

  it('should insert confirmed threats (isThreat: true) via insertPattern', async () => {
    mockExplorer.findNearMisses.mockResolvedValue([
      {
        record: { messageId: 'msg-1', deliveredContent: 'attack payload' },
        score: 0.85,
        layers: ['L2_ANALYZE']
      }
    ]);

    mockReviewer.review.mockResolvedValue({
      isThreat: true,
      finalSeverity: 0.95,
      reasoning: 'Confirmed attack',
      patterns: ['exploit']
    });

    await learner.hardenShield();

    expect(mockScanner.insertPattern).toHaveBeenCalledTimes(1);
    expect(mockScanner.insertPattern).toHaveBeenCalledWith(expect.objectContaining({
      id: 'learned:msg-1',
      metadata: expect.objectContaining({
        category: 'learned_threat',
        severity: 0.95
      })
    }));
  });

  it('should skip non-threats (isThreat: false), verify insertPattern not called for those', async () => {
    mockExplorer.findNearMisses.mockResolvedValue([
      {
        record: { messageId: 'msg-2', deliveredContent: 'false positive' },
        score: 0.75,
        layers: ['L1_SCAN']
      }
    ]);

    mockReviewer.review.mockResolvedValue({
      isThreat: false,
      finalSeverity: 0,
      reasoning: 'Safe context',
      patterns: []
    });

    await learner.hardenShield();

    expect(mockScanner.insertPattern).not.toHaveBeenCalled();
  });

  it('should return correct patternsLearned and patternsSkipped', async () => {
    mockExplorer.findNearMisses.mockResolvedValue([
      { record: { messageId: '1', deliveredContent: 'bad' }, score: 0.8, layers: [] },
      { record: { messageId: '2', deliveredContent: 'good' }, score: 0.7, layers: [] }
    ]);

    mockReviewer.review
      .mockResolvedValueOnce({ isThreat: true, finalSeverity: 0.9, reasoning: '', patterns: [] })
      .mockResolvedValueOnce({ isThreat: false, finalSeverity: 0, reasoning: '', patterns: [] });

    const result = await learner.hardenShield();

    expect(result.patternsLearned).toBe(1);
    expect(result.patternsSkipped).toBe(1);
  });
});

describe('Auditor: Normalization pipeline', () => {
  // Ref: AUD-8 (vector-scanner.ts:L63-130)

  it('should strip zero-width characters', () => {
    const input = 'h\u200Be\u200Dl\uFEFFl\u2060o';
    const normalized = normalizeInput(input);
    expect(normalized).toBe('hello');
  });

  it('should decode base64 payloads', () => {
    // "This is a longer secret payload" -> VGhpcyBpcyBhIGxvbmdlciBzZWNyZXQgcGF5bG9hZA==
    const base64 = 'VGhpcyBpcyBhIGxvbmdlciBzZWNyZXQgcGF5bG9hZA==';
    const input = `prefix ${base64} suffix`;

    const normalized = normalizeInput(input);

    expect(normalized).toContain('this is a longer secret payload');
  });

  it('should replace Cyrillic homoglyphs', () => {
    // \u0441 -> c, \u0430 -> a
    const input = '\u0441\u0430t';
    const normalized = normalizeInput(input);
    expect(normalized).toBe('cat');
  });

  it('should lowercase and collapse whitespace', () => {
    const input = '  HELLO   \t  WORLD  ';
    const normalized = normalizeInput(input);
    expect(normalized).toBe('hello world');
  });
});
