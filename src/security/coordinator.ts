/**
 * RuvBot Swarm - AIDefence Coordinator
 * PRD Reference: PRD.md v1.0.0 (Section 5: 6-Layer AIDefence Stack)
 *
 * Orchestrates the 6-Layer AIDefence Stack for the Architect Agent.
 * L1-L4 run synchronously (blocking). L5-L6 fire asynchronously.
 *
 * Latency budgets (from PRD Section 7.2):
 *   L1 Scan    <2ms   | L2 Analyze <8ms
 *   L3 Gate    <1ms   | L4 PII     <5ms
 *   Fast Path  <16ms  | Weighted Avg ~38ms
 */

import { performance } from 'perf_hooks';
import { VectorScanner } from './vector-scanner.js';
import type { GateDecision } from './min-cut-gate.js';

// ── Types ────────────────────────────────────────────────────────────

export enum ThreatLevel {
  SAFE = 'SAFE',
  FLAGGED = 'FLAGGED',
  BLOCKED = 'BLOCKED',
}

export interface LayerVerdict {
  layer: string;
  passed: boolean;
  score: number;
  latency_ms: number;
  details: Record<string, unknown>;
  error?: string;
}

export interface ScanResult {
  threat_detected: boolean;
  score: number;
  matched_patterns: string[];
}

export interface AnalysisResult {
  classification: string;
  confidence: number;
  vector_matches: number;
  dtw_score: number;
}

export interface SafetyVerdict {
  safe: boolean;
  threat_level: ThreatLevel;
  reason: string;
  final_score: number;
}

export interface PIIResult {
  has_pii: boolean;
  entities_found: string[];
  redacted_text: string;
}

export interface DefenceResult {
  verdict: ThreatLevel;
  is_blocked: boolean;
  safe_input: string;
  total_latency_ms: number;
  layer_timings: Record<string, number>;
  layer_verdicts: LayerVerdict[];
  block_reason?: string;
}

export interface CoordinatorConfig {
  thresholds: {
    block_score: number;
    flag_score: number;
  };
  timeouts: {
    fast_path_ms: number;
  };
  features: {
    enable_learning: boolean;
    enable_audit: boolean;
    fail_open_detection: boolean;
  };
}

// ── Constants ────────────────────────────────────────────────────────

export const LATENCY_BUDGETS: Record<string, number> = {
  L1_SCAN: 2.0,
  L2_ANALYZE: 8.0,
  L3_SAFE: 5.0,
  L4_PII: 5.0,
  TOTAL_FAST_PATH: 20.0,
};

export const DEFAULT_CONFIG: CoordinatorConfig = {
  thresholds: {
    block_score: 0.9,
    flag_score: 0.7,
  },
  timeouts: {
    fast_path_ms: 20,
  },
  features: {
    enable_learning: true,
    enable_audit: true,
    fail_open_detection: true,
  },
};

// ── MCP Client Interface ─────────────────────────────────────────────

export interface IMCPClient {
  scanInput(input: string): Promise<ScanResult>;
  analyzeThreats(input: string): Promise<AnalysisResult>;
  checkSafety(input: string, scanScore: number, analysisScore: number): Promise<SafetyVerdict>;
  detectPII(input: string): Promise<PIIResult>;
  learn(input: string, result: DefenceResult): Promise<void>;
  recordStats(result: DefenceResult): Promise<void>;
}

// ── Mock MCP Client (for tests / offline) ────────────────────────────

export class MockMCPClient implements IMCPClient {
  async scanInput(input: string): Promise<ScanResult> {
    const lowerInput = input.toLowerCase();
    const patterns: string[] = [];
    let score = 0;

    if (lowerInput.includes('ignore previous instructions')) {
      patterns.push('prompt_injection_override');
      score = Math.max(score, 0.95);
    }
    if (lowerInput.includes('you are now')) {
      patterns.push('role_hijack');
      score = Math.max(score, 0.85);
    }
    if (lowerInput.includes('system prompt')) {
      patterns.push('system_prompt_leak');
      score = Math.max(score, 0.80);
    }

    return {
      threat_detected: patterns.length > 0,
      score,
      matched_patterns: patterns,
    };
  }

  async analyzeThreats(input: string): Promise<AnalysisResult> {
    const length = input.length;
    const suspicion = length > 2000 ? 0.4 : 0.05;
    return {
      classification: suspicion > 0.3 ? 'suspicious' : 'informational',
      confidence: 0.9,
      vector_matches: 0,
      dtw_score: suspicion,
    };
  }

  async checkSafety(
    _input: string,
    scanScore: number,
    analysisScore: number,
  ): Promise<SafetyVerdict> {
    const maxScore = Math.max(scanScore, analysisScore);
    if (maxScore >= 0.9) {
      return { safe: false, threat_level: ThreatLevel.BLOCKED, reason: 'Threshold exceeded', final_score: maxScore };
    }
    if (maxScore >= 0.7) {
      return { safe: true, threat_level: ThreatLevel.FLAGGED, reason: 'Suspicious pattern', final_score: maxScore };
    }
    return { safe: true, threat_level: ThreatLevel.SAFE, reason: 'Clean', final_score: maxScore };
  }

  async detectPII(input: string): Promise<PIIResult> {
    const entities: string[] = [];
    let redacted = input;

    const emailRe = /[\w.+-]+@[\w.-]+\.\w+/g;
    if (emailRe.test(input)) {
      entities.push('email');
      redacted = redacted.replace(emailRe, '[REDACTED:EMAIL]');
    }

    const ssnRe = /\b\d{3}-\d{2}-\d{4}\b/g;
    if (ssnRe.test(input)) {
      entities.push('ssn');
      redacted = redacted.replace(ssnRe, '[REDACTED:SSN]');
    }

    return { has_pii: entities.length > 0, entities_found: entities, redacted_text: redacted };
  }

  async learn(): Promise<void> { /* no-op in mock */ }
  async recordStats(): Promise<void> { /* no-op in mock */ }
}

// ── AIDefence Coordinator ────────────────────────────────────────────

export class AIDefenceCoordinator {
  private config: CoordinatorConfig;
  private mcp: IMCPClient;
  private vectorScanner: VectorScanner;

  constructor(config: Partial<CoordinatorConfig> = {}, mcpClient?: IMCPClient) {
    this.config = {
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...config.thresholds },
      timeouts: { ...DEFAULT_CONFIG.timeouts, ...config.timeouts },
      features: { ...DEFAULT_CONFIG.features, ...config.features },
    };
    this.mcp = mcpClient ?? new MockMCPClient();
    this.vectorScanner = new VectorScanner();
  }

  /**
   * Pre-warm the VectorDB (coherence DB + attack-patterns DB).
   * Call this once at startup before serving requests.
   * Idempotent — safe to call multiple times.
   */
  public async initialize(): Promise<void> {
    await this.vectorScanner.initialize();
  }

  /**
   * Process a request through all 6 defence layers.
   * L1-L4 are blocking (must pass before agents see the input).
   * L5-L6 fire asynchronously after the verdict is determined.
   */
  public async processRequest(input: string): Promise<DefenceResult> {
    const t0 = performance.now();
    const verdicts: LayerVerdict[] = [];
    const timings: Record<string, number> = {};

    let currentInput = input;
    let isBlocked = false;
    let blockReason: string | undefined;
    let finalVerdict = ThreatLevel.SAFE;
    let l1Score = 0;
    let l2Score = 0;

    // ── L1: Input Scanning ───────────────────────────────────────
    const t1 = performance.now();
    try {
      const scan = await this.mcp.scanInput(currentInput);
      l1Score = scan.score;
      this.record(verdicts, timings, 'L1_SCAN', t1, true, l1Score, {
        threat_detected: scan.threat_detected,
        matched_patterns: scan.matched_patterns,
      });
    } catch (err) {
      this.failOpen('L1_SCAN', err, verdicts, timings, t1);
    }

    // ── L2: Deep Analysis ────────────────────────────────────────
    const t2 = performance.now();
    try {
      const analysis = await this.mcp.analyzeThreats(currentInput);
      l2Score = analysis.classification === 'attack' ? analysis.confidence : analysis.dtw_score;
      this.record(verdicts, timings, 'L2_ANALYZE', t2, true, l2Score, {
        classification: analysis.classification,
        vector_matches: analysis.vector_matches,
        dtw_score: analysis.dtw_score,
      });
    } catch (err) {
      this.failOpen('L2_ANALYZE', err, verdicts, timings, t2);
    }

    // ── Coherence Gate (between L2 and L3) ───────────────────────
    // Searches ruvbot-coherence.db with the input embedding and uses the
    // kNN density (λ proxy) to modulate l2Score before the L3 threshold check.
    //
    // Conservative design:
    //   - MinCut_Gate route (high density): l2Score += 0.05, capped at 1.0
    //   - L3_Gate route (sparse / cold-start): no change
    //   - Any failure: fail-open (no-op), never blocks on gate error
    //
    // The ±0.05 modifier pushes borderline inputs (e.g. l2Score=0.85) over
    // the 0.90 block threshold when the input lands in a dense pattern cluster.
    // It cannot create false positives on clean inputs: l2Score must already
    // be near the threshold for the boost to matter.
    let gateDecision: GateDecision | null = null;
    try {
      gateDecision = await this.vectorScanner.computeGateDecision(currentInput);
      if (gateDecision.route === 'MinCut_Gate') {
        l2Score = Math.min(1.0, l2Score + 0.05);
      }
    } catch (err) {
      console.warn('[AIDefence] Coherence gate error (fail-open, no-op):', err);
    }

    // ── L3: Safety Gate (fail-CLOSED) ────────────────────────────
    const t3 = performance.now();
    try {
      const safety = await this.mcp.checkSafety(currentInput, l1Score, l2Score);
      finalVerdict = safety.threat_level;

      if (!safety.safe || safety.threat_level === ThreatLevel.BLOCKED) {
        isBlocked = true;
        blockReason = safety.reason;
      }

      this.record(verdicts, timings, 'L3_SAFE', t3, safety.safe, safety.final_score, {
        threat_level: safety.threat_level,
        reason: safety.reason,
      });
    } catch (err) {
      // L3 is fail-CLOSED: error means block.
      isBlocked = true;
      blockReason = 'Safety gate internal error';
      finalVerdict = ThreatLevel.BLOCKED;

      const dur = performance.now() - t3;
      timings['L3_SAFE'] = dur;
      verdicts.push({
        layer: 'L3_SAFE', passed: false, score: 1.0, latency_ms: dur,
        details: {}, error: String(err),
      });
      console.error('[AIDefence] L3 FAILED — defaulting to BLOCK:', err);
    }

    // ── L4: PII Shield ───────────────────────────────────────────
    if (!isBlocked) {
      const t4 = performance.now();
      try {
        const pii = await this.mcp.detectPII(currentInput);
        if (pii.has_pii) {
          currentInput = pii.redacted_text;
        }
        this.record(verdicts, timings, 'L4_PII', t4, true, 0, {
          has_pii: pii.has_pii,
          entities_found: pii.entities_found,
        });
      } catch (err) {
        if (this.config.features.fail_open_detection) {
          this.failOpen('L4_PII', err, verdicts, timings, t4);
        } else {
          isBlocked = true;
          blockReason = 'PII detection failed (fail-closed)';
          finalVerdict = ThreatLevel.BLOCKED;
        }
      }
    }

    const totalLatency = performance.now() - t0;

    // Warn if total fast-path budget exceeded
    if (totalLatency > LATENCY_BUDGETS.TOTAL_FAST_PATH) {
      console.warn(
        `[AIDefence] Fast path budget exceeded: ${totalLatency.toFixed(2)}ms > ${LATENCY_BUDGETS.TOTAL_FAST_PATH}ms`,
      );
    }

    const result: DefenceResult = {
      verdict: finalVerdict,
      is_blocked: isBlocked,
      safe_input: isBlocked ? '' : currentInput,
      total_latency_ms: totalLatency,
      layer_timings: timings,
      layer_verdicts: verdicts,
      block_reason: blockReason,
    };

    // ── L5 + L6: Async (fire-and-forget) ─────────────────────────
    this.fireAsyncLayers(input, result);

    return result;
  }

  // ── Private helpers ────────────────────────────────────────────

  private record(
    verdicts: LayerVerdict[],
    timings: Record<string, number>,
    layer: string,
    start: number,
    passed: boolean,
    score: number,
    details: Record<string, unknown>,
  ): void {
    const dur = performance.now() - start;
    timings[layer] = dur;
    verdicts.push({ layer, passed, score, latency_ms: dur, details });

    const budget = LATENCY_BUDGETS[layer];
    if (budget !== undefined && dur > budget) {
      console.warn(`[AIDefence] ${layer} exceeded budget: ${dur.toFixed(2)}ms > ${budget}ms`);
    }
  }

  private failOpen(
    layer: string,
    err: unknown,
    verdicts: LayerVerdict[],
    timings: Record<string, number>,
    start: number,
  ): void {
    const dur = performance.now() - start;
    timings[layer] = dur;
    verdicts.push({
      layer, passed: true, score: 0, latency_ms: dur,
      details: {}, error: String(err),
    });
    console.warn(`[AIDefence] ${layer} failed (fail-open):`, err);
  }

  private fireAsyncLayers(originalInput: string, result: DefenceResult): void {
    if (this.config.features.enable_learning) {
      this.mcp.learn(originalInput, result).catch((err) => {
        console.error('[AIDefence] L5 Learn error:', err);
      });
    }
    if (this.config.features.enable_audit) {
      this.mcp.recordStats(result).catch((err) => {
        console.error('[AIDefence] L6 Stats error:', err);
      });
    }
  }
}
