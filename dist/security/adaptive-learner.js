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
import { MockMCPClient, } from './coordinator.js';
// ── Neural MCP Client ────────────────────────────────────────────────
/**
 * IMCPClient that uses VectorScanner as the L2 backend.
 * Wires the Neural Shield into the coordinator pipeline so
 * adaptive learning directly improves threat detection.
 */
export class NeuralMCPClient extends MockMCPClient {
    scanner;
    constructor(scanner) {
        super();
        this.scanner = scanner;
    }
    async analyzeThreats(input) {
        return this.scanner.scan(input);
    }
}
// ── Adaptive Learner ─────────────────────────────────────────────────
export class AdaptiveLearner {
    scanner;
    explorer;
    reviewer;
    constructor(scanner, explorer, reviewer) {
        this.scanner = scanner;
        this.explorer = explorer;
        this.reviewer = reviewer;
    }
    /**
     * The core feedback loop.
     * 1. Find near-misses from the audit trail
     * 2. Have the Reviewer label each one
     * 3. Insert confirmed threats into the HNSW index
     *
     * Must be called ASYNCHRONOUSLY (fire-and-forget from dispatch loop).
     */
    async hardenShield() {
        const nearMisses = await this.explorer.findNearMisses();
        const details = [];
        let skipped = 0;
        for (const nm of nearMisses) {
            const label = await this.reviewer.review(nm.record.deliveredContent, nm.score, nm.layers);
            if (!label.isThreat) {
                skipped++;
                continue;
            }
            const patternId = `learned:${nm.record.messageId}`;
            const normalized = this.scanner.normalizeInput(nm.record.deliveredContent);
            const vector = this.scanner.textToVector(normalized);
            await this.scanner.insertPattern({
                id: patternId,
                vector,
                metadata: {
                    category: 'learned_threat',
                    severity: label.finalSeverity,
                    source: 'adaptive-learner',
                    reasoning: label.reasoning,
                    originalScore: nm.score,
                    patterns: label.patterns,
                },
            });
            details.push({
                messageId: nm.record.messageId,
                patternId,
                severity: label.finalSeverity,
                reasoning: label.reasoning,
            });
        }
        return {
            patternsLearned: details.length,
            patternsSkipped: skipped,
            details,
        };
    }
    /**
     * Learn from a single near-miss (for targeted hardening).
     */
    async learnFromNearMiss(nm, label) {
        if (!label.isThreat)
            return null;
        const patternId = `learned:${nm.record.messageId}`;
        const normalized = this.scanner.normalizeInput(nm.record.deliveredContent);
        const vector = this.scanner.textToVector(normalized);
        await this.scanner.insertPattern({
            id: patternId,
            vector,
            metadata: {
                category: 'learned_threat',
                severity: label.finalSeverity,
                source: 'adaptive-learner',
                reasoning: label.reasoning,
            },
        });
        return {
            messageId: nm.record.messageId,
            patternId,
            severity: label.finalSeverity,
            reasoning: label.reasoning,
        };
    }
}
