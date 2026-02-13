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
import { type IMCPClient, type ScanResult, type AnalysisResult, type SafetyVerdict, type PIIResult, type DefenceResult } from './coordinator.js';
import { VectorScanner } from './vector-scanner.js';
/**
 * Generic function signature for calling MCP tools.
 * Allows injection of any transport (Claude Flow, HTTP, test mock).
 */
export type MCPToolCaller = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
/**
 * Live implementation of IMCPClient that bridges the Coordinator
 * to actual MCP tools via a provided tool caller.
 */
export declare class LiveMCPClient implements IMCPClient {
    protected callTool: MCPToolCaller;
    constructor(callTool: MCPToolCaller);
    /** L1: Input scanning via aidefence_scan */
    scanInput(input: string): Promise<ScanResult>;
    /** L2: Deep analysis via aidefence_analyze */
    analyzeThreats(input: string): Promise<AnalysisResult>;
    /**
     * L3: Safety gate via aidefence_is_safe
     * Errors MUST propagate — coordinator enforces L3 fail-CLOSED.
     */
    checkSafety(input: string, scanScore: number, analysisScore: number): Promise<SafetyVerdict>;
    /** L4: PII detection via aidefence_has_pii */
    detectPII(input: string): Promise<PIIResult>;
    /** L5: Feedback recording via aidefence_learn */
    learn(input: string, result: DefenceResult): Promise<void>;
    /** L6: Stats recording via aidefence_stats */
    recordStats(_result: DefenceResult): Promise<void>;
}
/**
 * Extended client that uses local VectorScanner for L2 analysis
 * instead of the remote MCP tool, reducing latency for HNSW lookups.
 */
export declare class NeuralLiveMCPClient extends LiveMCPClient {
    private scanner;
    constructor(callTool: MCPToolCaller, scanner: VectorScanner);
    /** Override L2 to use local HNSW Neural Shield */
    analyzeThreats(input: string): Promise<AnalysisResult>;
}
