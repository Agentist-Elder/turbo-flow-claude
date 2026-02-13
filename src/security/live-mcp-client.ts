/**
 * RuvBot Swarm - Live MCP Client
 * Phase 7b: Wire real MCP tools into the AIDefence Coordinator
 *
 * Replaces MockMCPClient for production use. Each IMCPClient method
 * maps to a real MCP tool via a generic callTool function.
 *
 * Error handling policy:
 *   Methods do NOT catch errors internally — they let them propagate
 *   to the coordinator, which handles fail-open (L1/L2/L4) and
 *   fail-CLOSED (L3) behavior. Only shape mismatches use defaults.
 */

import {
  type IMCPClient,
  type ScanResult,
  type AnalysisResult,
  type SafetyVerdict,
  type PIIResult,
  type DefenceResult,
  ThreatLevel,
} from './coordinator.js';
import { VectorScanner } from './vector-scanner.js';

/**
 * Generic function signature for calling MCP tools.
 * Allows injection of any transport (Claude Flow, HTTP, test mock).
 */
export type MCPToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

// ── Raw MCP tool response shapes ─────────────────────────────────────

interface MCPScanResponse {
  threat_level?: string;
  score?: number;
  threats?: string[];
  recommendations?: string[];
  blocked?: boolean;
}

interface MCPAnalyzeResponse {
  classification?: string;
  confidence?: number;
  similar_patterns?: Array<unknown>;
  threat_types?: string[];
  mitigation?: string[];
}

interface MCPSafetyResponse {
  safe: boolean;
  reason?: string;
  score?: number;
}

interface MCPPIIResponse {
  has_pii: boolean;
  types?: string[];
  details?: Array<unknown>;
}

// ── Live MCP Client ──────────────────────────────────────────────────

/**
 * Live implementation of IMCPClient that bridges the Coordinator
 * to actual MCP tools via a provided tool caller.
 */
export class LiveMCPClient implements IMCPClient {
  protected callTool: MCPToolCaller;

  constructor(callTool: MCPToolCaller) {
    this.callTool = callTool;
  }

  /** L1: Input scanning via aidefence_scan */
  async scanInput(input: string): Promise<ScanResult> {
    const raw = (await this.callTool('aidefence_scan', { input })) as MCPScanResponse;
    const score = raw.score ?? 0;
    return {
      threat_detected: raw.blocked === true || score > 0.7,
      score,
      matched_patterns: raw.threats ?? [],
    };
  }

  /** L2: Deep analysis via aidefence_analyze */
  async analyzeThreats(input: string): Promise<AnalysisResult> {
    const raw = (await this.callTool('aidefence_analyze', {
      input,
      searchSimilar: true,
    })) as MCPAnalyzeResponse;
    return {
      classification: raw.classification ?? 'unknown',
      confidence: raw.confidence ?? 0,
      vector_matches: (raw.similar_patterns ?? []).length,
      dtw_score: 0,
    };
  }

  /**
   * L3: Safety gate via aidefence_is_safe
   * Errors MUST propagate — coordinator enforces L3 fail-CLOSED.
   */
  async checkSafety(
    input: string,
    scanScore: number,
    analysisScore: number,
  ): Promise<SafetyVerdict> {
    const rawResponse = await this.callTool('aidefence_is_safe', { input });

    // Unwrap MCP content envelope: { content: [{ type: "text", text: "..." }] }
    let parsed: MCPSafetyResponse;
    const envelope = rawResponse as { content?: Array<{ type: string; text?: string }> };
    if (envelope.content && Array.isArray(envelope.content) && envelope.content[0]?.type === 'text' && typeof envelope.content[0].text === 'string') {
      parsed = JSON.parse(envelope.content[0].text) as MCPSafetyResponse;
    } else {
      parsed = rawResponse as MCPSafetyResponse;
    }

    if (typeof parsed !== 'object' || parsed === null || typeof parsed.safe !== 'boolean') {
      throw new Error('Invalid response shape from aidefence_is_safe');
    }

    const finalScore = parsed.score ?? Math.max(scanScore, analysisScore);

    let threatLevel = ThreatLevel.SAFE;
    if (!parsed.safe) {
      threatLevel = ThreatLevel.BLOCKED;
    } else if (finalScore >= 0.7) {
      threatLevel = ThreatLevel.FLAGGED;
    }

    return {
      safe: parsed.safe,
      threat_level: threatLevel,
      reason: parsed.reason ?? (parsed.safe ? 'Input assessed as safe' : 'Unsafe content detected'),
      final_score: finalScore,
    };
  }

  /** L4: PII detection via aidefence_has_pii */
  async detectPII(input: string): Promise<PIIResult> {
    const raw = (await this.callTool('aidefence_has_pii', { input })) as MCPPIIResponse;

    let redactedText = input;
    if (raw.has_pii) {
      // Fallback regex redaction (MCP tool doesn't return redacted text)
      redactedText = redactedText.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[REDACTED:EMAIL]');
      redactedText = redactedText.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED:SSN]');
    }

    return {
      has_pii: raw.has_pii,
      entities_found: raw.types ?? [],
      redacted_text: redactedText,
    };
  }

  /** L5: Feedback recording via aidefence_learn */
  async learn(input: string, result: DefenceResult): Promise<void> {
    await this.callTool('aidefence_learn', {
      input,
      wasAccurate: result.verdict === ThreatLevel.BLOCKED,
      verdict: result.verdict,
      threatType: result.block_reason,
      mitigationStrategy: result.is_blocked ? 'block' : 'log',
    });
  }

  /** L6: Stats recording via aidefence_stats */
  async recordStats(_result: DefenceResult): Promise<void> {
    await this.callTool('aidefence_stats', {});
  }
}

// ── Neural Live MCP Client ───────────────────────────────────────────

/**
 * Extended client that uses local VectorScanner for L2 analysis
 * instead of the remote MCP tool, reducing latency for HNSW lookups.
 */
export class NeuralLiveMCPClient extends LiveMCPClient {
  private scanner: VectorScanner;

  constructor(callTool: MCPToolCaller, scanner: VectorScanner) {
    super(callTool);
    this.scanner = scanner;
  }

  /** Override L2 to use local HNSW Neural Shield */
  override async analyzeThreats(input: string): Promise<AnalysisResult> {
    return this.scanner.scan(input);
  }
}
