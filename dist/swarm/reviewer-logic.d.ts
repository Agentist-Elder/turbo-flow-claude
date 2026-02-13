/**
 * RuvBot Swarm - Reviewer Logic
 * PRD Reference: PRD.md v1.0.0 — Section 4.2 (Worker Spawn: reviewer)
 *
 * Structured analysis logic for the Reviewer Agent (Gemini 2.5 Flash).
 * Reviews near-miss content and labels adversarial patterns.
 */
export interface LabelResult {
    isThreat: boolean;
    finalSeverity: number;
    reasoning: string;
    patterns: string[];
}
export interface ReviewContext {
    content: string;
    score: number;
    layers: string[];
    prompt: string;
}
/**
 * Abstraction over the LLM used for review.
 * Production: Gemini 2.5 Flash via PAL bridge.
 * Tests: mock/stub.
 */
export interface IReviewerModel {
    analyze(content: string, context: ReviewContext): Promise<LabelResult>;
}
export declare class StubReviewerModel implements IReviewerModel {
    analyze(): Promise<LabelResult>;
}
export declare class ReviewerLogic {
    private model;
    constructor(model?: IReviewerModel);
    /**
     * Build a structured analysis prompt for the Reviewer Agent.
     * The prompt instructs the model to check for specific adversarial patterns.
     */
    buildPrompt(content: string, score: number, layers: string[]): string;
    /**
     * Review near-miss content for adversarial patterns.
     * Returns a structured LabelResult with threat classification.
     */
    review(content: string, score: number, layers: string[]): Promise<LabelResult>;
}
