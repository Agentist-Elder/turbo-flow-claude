import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveMCPClient, NeuralLiveMCPClient } from '../../src/security/live-mcp-client.js';
import { ThreatLevel, type DefenceResult } from '../../src/security/coordinator.js';

// ── L1: scanInput ────────────────────────────────────────────────────

describe('LiveMCPClient: L1 scanInput', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let client: LiveMCPClient;

  beforeEach(() => {
    callTool = vi.fn();
    client = new LiveMCPClient(callTool);
  });

  it('should call aidefence_scan with { input }', async () => {
    callTool.mockResolvedValueOnce({ score: 0.9, threats: ['prompt_injection'], blocked: true });
    await client.scanInput('malicious input');
    expect(callTool).toHaveBeenCalledWith('aidefence_scan', { input: 'malicious input' });
  });

  it('should map threat response to ScanResult shape', async () => {
    callTool.mockResolvedValueOnce({ score: 0.9, threats: ['prompt_injection', 'jailbreak'], blocked: true });
    const result = await client.scanInput('attack');
    expect(result).toEqual({
      threat_detected: true,
      score: 0.9,
      matched_patterns: ['prompt_injection', 'jailbreak'],
    });
  });

  it('should return score:0, threat_detected:false for clean input', async () => {
    callTool.mockResolvedValueOnce({ score: 0, threats: [], blocked: false });
    const result = await client.scanInput('hello world');
    expect(result).toEqual({
      threat_detected: false,
      score: 0,
      matched_patterns: [],
    });
  });

  it('should handle missing fields with defaults', async () => {
    callTool.mockResolvedValueOnce({});
    const result = await client.scanInput('test');
    expect(result).toEqual({
      threat_detected: false,
      score: 0,
      matched_patterns: [],
    });
  });
});

// ── L2: analyzeThreats ──────────────────────────────────────────────

describe('LiveMCPClient: L2 analyzeThreats', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let client: LiveMCPClient;

  beforeEach(() => {
    callTool = vi.fn();
    client = new LiveMCPClient(callTool);
  });

  it('should call aidefence_analyze with { input, searchSimilar: true }', async () => {
    callTool.mockResolvedValueOnce({ classification: 'informational', confidence: 0 });
    await client.analyzeThreats('test input');
    expect(callTool).toHaveBeenCalledWith('aidefence_analyze', {
      input: 'test input',
      searchSimilar: true,
    });
  });

  it('should map analysis response to AnalysisResult shape', async () => {
    callTool.mockResolvedValueOnce({
      classification: 'attack',
      confidence: 0.85,
      similar_patterns: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
      threat_types: ['prompt_injection'],
    });
    const result = await client.analyzeThreats('attack');
    expect(result).toEqual({
      classification: 'attack',
      confidence: 0.85,
      vector_matches: 3,
      dtw_score: 0,
    });
  });
});

// ── L3: checkSafety ─────────────────────────────────────────────────

describe('LiveMCPClient: L3 checkSafety', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let client: LiveMCPClient;

  beforeEach(() => {
    callTool = vi.fn();
    client = new LiveMCPClient(callTool);
  });

  it('should call aidefence_is_safe with { input }', async () => {
    callTool.mockResolvedValueOnce({ safe: true, score: 0.1 });
    await client.checkSafety('test', 0.5, 0.3);
    expect(callTool).toHaveBeenCalledWith('aidefence_is_safe', { input: 'test' });
  });

  it('should return BLOCKED when safe=false', async () => {
    callTool.mockResolvedValueOnce({ safe: false, reason: 'Dangerous content', score: 0.95 });
    const result = await client.checkSafety('attack', 0.5, 0.6);
    expect(result.safe).toBe(false);
    expect(result.threat_level).toBe(ThreatLevel.BLOCKED);
    expect(result.reason).toBe('Dangerous content');
    expect(result.final_score).toBe(0.95);
  });

  it('should return FLAGGED when safe=true but score >= 0.7', async () => {
    callTool.mockResolvedValueOnce({ safe: true, reason: 'Suspicious', score: 0.75 });
    const result = await client.checkSafety('suspicious', 0.5, 0.6);
    expect(result.threat_level).toBe(ThreatLevel.FLAGGED);
    expect(result.final_score).toBe(0.75);
  });

  it('should return SAFE when safe=true and score < 0.7', async () => {
    callTool.mockResolvedValueOnce({ safe: true, reason: 'Clean', score: 0.2 });
    const result = await client.checkSafety('clean', 0.1, 0.1);
    expect(result.threat_level).toBe(ThreatLevel.SAFE);
  });

  it('should use max(scanScore, analysisScore) as fallback when tool returns no score', async () => {
    callTool.mockResolvedValueOnce({ safe: true, reason: 'No score' });
    const result = await client.checkSafety('test', 0.5, 0.6);
    expect(result.final_score).toBe(0.6);
    expect(result.threat_level).toBe(ThreatLevel.SAFE);
  });

  it('should return FLAGGED via fallback score when max(scanScore, analysisScore) >= 0.7', async () => {
    callTool.mockResolvedValueOnce({ safe: true });
    const result = await client.checkSafety('test', 0.8, 0.3);
    expect(result.final_score).toBe(0.8);
    expect(result.threat_level).toBe(ThreatLevel.FLAGGED);
  });

  it('should let errors propagate (L3 fail-CLOSED preserved)', async () => {
    callTool.mockRejectedValueOnce(new Error('MCP timeout'));
    await expect(client.checkSafety('test', 0, 0)).rejects.toThrow('MCP timeout');
  });
});

// ── L4: detectPII ───────────────────────────────────────────────────

describe('LiveMCPClient: L4 detectPII', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let client: LiveMCPClient;

  beforeEach(() => {
    callTool = vi.fn();
    client = new LiveMCPClient(callTool);
  });

  it('should call aidefence_has_pii with { input }', async () => {
    callTool.mockResolvedValueOnce({ has_pii: false });
    await client.detectPII('clean text');
    expect(callTool).toHaveBeenCalledWith('aidefence_has_pii', { input: 'clean text' });
  });

  it('should redact emails when PII detected', async () => {
    callTool.mockResolvedValueOnce({ has_pii: true, types: ['email'] });
    const result = await client.detectPII('contact dev@ruvbot.internal for help');
    expect(result.has_pii).toBe(true);
    expect(result.entities_found).toContain('email');
    expect(result.redacted_text).toContain('[REDACTED:EMAIL]');
    expect(result.redacted_text).not.toContain('dev@ruvbot.internal');
  });

  it('should redact SSNs when PII detected', async () => {
    callTool.mockResolvedValueOnce({ has_pii: true, types: ['ssn'] });
    const result = await client.detectPII('SSN: 123-45-6789');
    expect(result.has_pii).toBe(true);
    expect(result.redacted_text).toContain('[REDACTED:SSN]');
    expect(result.redacted_text).not.toContain('123-45-6789');
  });

  it('should return has_pii:false for clean input', async () => {
    const clean = 'No sensitive data here';
    callTool.mockResolvedValueOnce({ has_pii: false });
    const result = await client.detectPII(clean);
    expect(result).toEqual({
      has_pii: false,
      entities_found: [],
      redacted_text: clean,
    });
  });
});

// ── L5: learn ───────────────────────────────────────────────────────

describe('LiveMCPClient: L5 learn', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let client: LiveMCPClient;

  const blockedResult: DefenceResult = {
    verdict: ThreatLevel.BLOCKED,
    is_blocked: true,
    safe_input: '',
    total_latency_ms: 5,
    layer_timings: {},
    layer_verdicts: [],
    block_reason: 'injection detected',
  };

  const safeResult: DefenceResult = {
    verdict: ThreatLevel.SAFE,
    is_blocked: false,
    safe_input: 'clean',
    total_latency_ms: 3,
    layer_timings: {},
    layer_verdicts: [],
  };

  beforeEach(() => {
    callTool = vi.fn().mockResolvedValue(undefined);
    client = new LiveMCPClient(callTool);
  });

  it('should call aidefence_learn with wasAccurate=true when BLOCKED', async () => {
    await client.learn('attack input', blockedResult);
    expect(callTool).toHaveBeenCalledWith('aidefence_learn', expect.objectContaining({
      input: 'attack input',
      wasAccurate: true,
      verdict: ThreatLevel.BLOCKED,
      threatType: 'injection detected',
      mitigationStrategy: 'block',
    }));
  });

  it('should call aidefence_learn with wasAccurate=false when SAFE', async () => {
    await client.learn('clean input', safeResult);
    expect(callTool).toHaveBeenCalledWith('aidefence_learn', expect.objectContaining({
      input: 'clean input',
      wasAccurate: false,
      mitigationStrategy: 'log',
    }));
  });

  it('should pass block_reason as threatType when BLOCKED', async () => {
    await client.learn('attack', blockedResult);
    const [, args] = callTool.mock.calls[0];
    expect(args.threatType).toBe('injection detected');
  });
});

// ── L6: recordStats ─────────────────────────────────────────────────

describe('LiveMCPClient: L6 recordStats', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let client: LiveMCPClient;

  const result: DefenceResult = {
    verdict: ThreatLevel.SAFE,
    is_blocked: false,
    safe_input: 'test',
    total_latency_ms: 3,
    layer_timings: {},
    layer_verdicts: [],
  };

  beforeEach(() => {
    callTool = vi.fn().mockResolvedValue({});
    client = new LiveMCPClient(callTool);
  });

  it('should call aidefence_stats', async () => {
    await client.recordStats(result);
    expect(callTool).toHaveBeenCalledWith('aidefence_stats', {});
  });
});

// ── NeuralLiveMCPClient: L2 override ────────────────────────────────

describe('NeuralLiveMCPClient: L2 override', () => {
  let callTool: ReturnType<typeof vi.fn>;
  let mockScanner: any;
  let client: NeuralLiveMCPClient;

  beforeEach(() => {
    callTool = vi.fn();
    mockScanner = {
      scan: vi.fn().mockResolvedValue({
        classification: 'attack',
        confidence: 0.9,
        vector_matches: 5,
        dtw_score: 0.1,
      }),
    };
    client = new NeuralLiveMCPClient(callTool, mockScanner);
  });

  it('should NOT call aidefence_analyze (uses VectorScanner instead)', async () => {
    await client.analyzeThreats('test input');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('should call scanner.scan() for analyzeThreats', async () => {
    const result = await client.analyzeThreats('test input');
    expect(mockScanner.scan).toHaveBeenCalledWith('test input');
    expect(result.classification).toBe('attack');
    expect(result.confidence).toBe(0.9);
  });

  it('should still use LiveMCPClient for other layers', async () => {
    callTool.mockResolvedValueOnce({ score: 0.1, blocked: false, threats: [] });
    await client.scanInput('test');
    expect(callTool).toHaveBeenCalledWith('aidefence_scan', { input: 'test' });
  });
});
