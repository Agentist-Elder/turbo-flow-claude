/**
 * RuvBot Swarm - Adaptive Learner
 * PRD Reference: PRD.md v1.0.0 — Section 5.5 (L5 Adaptive Learning)
 *
 * Closes the feedback loop: Reactive (Block/Pass) -> Adaptive (Learn/Evolve).
 *
 * Pipeline:
 *   1. Explorer finds near-misses (0.7 ≤ score < 0.9) from swarm_audit
 *   2. Reviewer labels them as threat / not-threat
 *   3. For confirmed threats, hardenShield() inserts normalized vector
 *      into the HNSW index as a permanent High-Severity Threat Vector
 *
 * All learning is ASYNCHRONOUS — never blocks SwarmOrchestrator.dispatch().
 */
import { VectorScanner } from './vector-scanner.js';
import { SecurityExplorer, type NearMiss } from './explorer.js';
import { ReviewerLogic, type LabelResult } from '../swarm/reviewer-logic.js';
import { MockMCPClient, type AnalysisResult } from './coordinator.js';
export interface LearnedPattern {
    messageId: string;
    patternId: string;
    severity: number;
    reasoning: string;
}
export interface HardenResult {
    patternsLearned: number;
    patternsSkipped: number;
    details: LearnedPattern[];
}
/**
 * IMCPClient that uses VectorScanner as the L2 backend.
 * Wires the Neural Shield into the coordinator pipeline so
 * adaptive learning directly improves threat detection.
 */
export declare class NeuralMCPClient extends MockMCPClient {
    private scanner;
    constructor(scanner: VectorScanner);
    analyzeThreats(input: string): Promise<AnalysisResult>;
}
export declare class AdaptiveLearner {
    private scanner;
    private explorer;
    private reviewer;
    constructor(scanner: VectorScanner, explorer: SecurityExplorer, reviewer: ReviewerLogic);
    /**
     * The core feedback loop.
     * 1. Find near-misses from the audit trail
     * 2. Have the Reviewer label each one
     * 3. Insert confirmed threats into the HNSW index
     *
     * Must be called ASYNCHRONOUSLY (fire-and-forget from dispatch loop).
     */
    hardenShield(): Promise<HardenResult>;
    /**
     * Learn from a single near-miss (for targeted hardening).
     */
    learnFromNearMiss(nm: NearMiss, label: LabelResult): Promise<LearnedPattern | null>;
}
