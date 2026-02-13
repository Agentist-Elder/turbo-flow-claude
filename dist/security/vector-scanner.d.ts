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
export interface AnalysisResult {
    classification: 'attack' | 'suspicious' | 'informational';
    confidence: number;
    vector_matches: number;
    dtw_score: number;
}
export interface VectorScannerConfig {
    dbPath: string;
    dimensions: number;
    attackThreshold: number;
    suspiciousThreshold: number;
    searchK: number;
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
    private initialized;
    private patternRegistry;
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
}
