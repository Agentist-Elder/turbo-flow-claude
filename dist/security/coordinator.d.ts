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
export declare enum ThreatLevel {
    SAFE = "SAFE",
    FLAGGED = "FLAGGED",
    BLOCKED = "BLOCKED"
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
export declare const LATENCY_BUDGETS: Record<string, number>;
export declare const DEFAULT_CONFIG: CoordinatorConfig;
export interface IMCPClient {
    scanInput(input: string): Promise<ScanResult>;
    analyzeThreats(input: string): Promise<AnalysisResult>;
    checkSafety(input: string, scanScore: number, analysisScore: number): Promise<SafetyVerdict>;
    detectPII(input: string): Promise<PIIResult>;
    learn(input: string, result: DefenceResult): Promise<void>;
    recordStats(result: DefenceResult): Promise<void>;
}
export declare class MockMCPClient implements IMCPClient {
    scanInput(input: string): Promise<ScanResult>;
    analyzeThreats(input: string): Promise<AnalysisResult>;
    checkSafety(_input: string, scanScore: number, analysisScore: number): Promise<SafetyVerdict>;
    detectPII(input: string): Promise<PIIResult>;
    learn(): Promise<void>;
    recordStats(): Promise<void>;
}
export declare class AIDefenceCoordinator {
    private config;
    private mcp;
    constructor(config?: Partial<CoordinatorConfig>, mcpClient?: IMCPClient);
    /**
     * Process a request through all 6 defence layers.
     * L1-L4 are blocking (must pass before agents see the input).
     * L5-L6 fire asynchronously after the verdict is determined.
     */
    processRequest(input: string): Promise<DefenceResult>;
    private record;
    private failOpen;
    private fireAsyncLayers;
}
