/**
 * RuvBot Swarm - L2 Vector Scanner (The Neural Shield)
 * PRD Reference: PRD.md v1.0.0 — Section 5.2 Layer L2, Section 7.2 (<8ms budget)
 *
 * Closes two evasion gaps proven by red-team tests:
 *   1. Unicode invisible characters (ZWS, ZWJ) bypass string matching
 *   2. Base64-encoded payloads bypass string matching
 *
 * Solution: 3-stage SONA-style normalization -> deterministic embedding -> HNSW search
 */
import { type GateDecision } from './min-cut-gate.js';
export interface PartitionRatioResult {
    ratio: number;
    d_attack: number;
    d_clean: number;
    dbSizeAttack: number;
    dbSizeClean: number;
}
export interface AnalysisResult {
    classification: 'attack' | 'suspicious' | 'informational';
    confidence: number;
    vector_matches: number;
    dtw_score: number;
}
export interface VectorScannerConfig {
    dbPath: string;
    /** Path to the seeded coherence DB for gate routing (ruvbot-coherence.db). */
    coherenceDbPath?: string;
    /** Path to the clean reference DB for Partition Ratio Score (ruvbot-clean-reference.db). */
    cleanReferenceDbPath?: string;
    dimensions: number;
    attackThreshold: number;
    suspiciousThreshold: number;
    searchK: number;
}
export interface ScanResultWithGate extends AnalysisResult {
    gate_decision?: GateDecision;
}
export declare const DEFAULT_SCANNER_CONFIG: VectorScannerConfig;
/**
 * Full 3-stage normalization pipeline.
 */
export declare function normalizeInput(input: string): string;
/**
 * Deterministic text-to-vector embedding.
 * Must match the function used to seed the HNSW index.
 * Performance: <1ms for typical inputs.
 */
export declare function textToVector(text: string, dimensions?: number): number[];
export interface PatternEntry {
    id: string;
    vector: number[];
    metadata: Record<string, unknown>;
}
export interface ThreatCluster {
    category: string;
    count: number;
    density: number;
    centroid: number[];
    patternIds: string[];
}
export declare class VectorScanner {
    private config;
    private db;
    private coherenceDb;
    private cleanDb;
    private initialized;
    private patternRegistry;
    private minCutGate;
    private coherenceGate;
    private lastGateDecision;
    constructor(config?: Partial<VectorScannerConfig>);
    /** Open the vector database. Must be called before scan(). */
    initialize(): Promise<void>;
    /** Expose normalization for external use / testing. */
    normalizeInput(input: string): string;
    /** Expose embedding for external use / testing. */
    textToVector(text: string): number[];
    /**
     * Full L2 scan pipeline: normalize -> embed -> HNSW search -> classify.
     * Target: <8ms total (PRD Section 7.2).
     */
    scan(input: string): Promise<AnalysisResult>;
    /**
     * Insert a new threat pattern into the HNSW index.
     * Used by AdaptiveLearner to harden the shield with confirmed threats.
     */
    insertPattern(pattern: PatternEntry): Promise<void>;
    /**
     * Return cluster analysis of the HNSW index (top 5 densest regions).
     * Groups patterns by metadata.category, computes centroid + density.
     */
    getThreatMap(): ThreatCluster[];
    /** Number of patterns tracked by this instance. */
    get registrySize(): number;
    /**
     * Last gate routing decision from scan().
     * Includes λ estimate, threshold, and whether MinCut_Gate was selected.
     * null if scan() has not been called yet.
     */
    get lastGate(): GateDecision | null;
    /**
     * Measure λ for a given set of k-NN distances (exposed for testing).
     */
    measureLambda(knnDistances: number[]): number;
    /**
     * Search the coherence DB and return the raw cosine distances (not yet
     * aggregated into λ). Used by calibration probes that need per-neighbor
     * distances for Stoer-Wagner star-graph min-cut computation.
     *
     * Fails safe: returns empty array if DB unavailable or search throws.
     */
    searchCoherenceDbDistances(vector: number[], k: number): Promise<{
        distances: number[];
        dbSize: number;
    }>;
    /**
     * Search the coherence DB with a pre-computed semantic embedding and return
     * the raw λ density proxy + DB size. Used by the async auditor in runGoal()
     * which supplies a true ONNX embedding instead of the fast-path char-code proxy.
     *
     * Fails safe: returns λ=0 if the coherence DB is unavailable or search throws.
     */
    searchCoherenceDb(vector: number[], k: number): Promise<{
        lambda: number;
        dbSize: number;
    }>;
    /**
     * Compute the Partition Ratio Score for a pre-computed ONNX embedding.
     *
     * ratio = d_clean / d_attack
     *
     * Where d_attack = avg cosine distance to k nearest neighbors in the
     * attack coherence DB (ruvbot-coherence.db) and d_clean = avg cosine
     * distance to k nearest neighbors in the clean reference DB
     * (ruvbot-clean-reference.db, seeded with 50 benign prompts).
     *
     * ratio > PARTITION_RATIO_THRESHOLD (1.0) → closer to attack space
     * ratio ≤ PARTITION_RATIO_THRESHOLD (1.0) → closer to clean space
     *
     * Returns null if either DB is unavailable (caller should fall back to λ).
     * Never throws to the caller.
     */
    partitionRatioScore(vector: number[], k: number): Promise<PartitionRatioResult | null>;
    /**
     * Compute the MinCutGate routing decision for an input by searching
     * the coherence DB (ruvbot-coherence.db, seeded with 630 synthetic patterns).
     *
     * Uses db.len() — not patternRegistry.length — so the gate reflects
     * the persisted DB size regardless of how many patterns were inserted
     * in this session.
     *
     * Fails safe: returns L3_Gate decision if the coherence DB is unavailable
     * or the search throws. Never throws to the caller.
     */
    computeGateDecision(input: string): Promise<GateDecision>;
}
