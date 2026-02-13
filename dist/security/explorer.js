/**
 * RuvBot Swarm - Security Explorer
 * PRD Reference: PRD.md v1.0.0 — Section 5.5 (L5 Adaptive Learning)
 *
 * Queries the swarm_audit namespace for 'Near-Miss' handoffs:
 * messages that scored 0.7 ≤ score < 0.9 (FLAGGED but not BLOCKED).
 * These are the most valuable signals for adaptive learning.
 */
export const DEFAULT_NEAR_MISS_CONFIG = {
    minScore: 0.7,
    maxScore: 0.9,
};
export class InMemoryAuditStore {
    records = [];
    addRecord(record) {
        this.records.push(record);
    }
    async listRecords(_namespace) {
        return [...this.records];
    }
}
// ── Security Explorer ────────────────────────────────────────────────
export class SecurityExplorer {
    store;
    config;
    namespace;
    constructor(store, namespace = 'swarm_audit', config = {}) {
        this.store = store;
        this.namespace = namespace;
        this.config = { ...DEFAULT_NEAR_MISS_CONFIG, ...config };
    }
    /**
     * Find all near-miss handoffs: 0.7 ≤ maxLayerScore < 0.9.
     * These are FLAGGED messages that almost triggered the Kill Switch.
     */
    async findNearMisses() {
        const records = await this.store.listRecords(this.namespace);
        const nearMisses = [];
        for (const record of records) {
            const layerScores = record.defenceResult.layer_verdicts.map(v => v.score);
            const maxScore = Math.max(...layerScores);
            if (maxScore >= this.config.minScore && maxScore < this.config.maxScore) {
                const flaggedLayers = record.defenceResult.layer_verdicts
                    .filter(v => v.score >= this.config.minScore)
                    .map(v => v.layer);
                nearMisses.push({
                    record,
                    score: parseFloat(maxScore.toFixed(4)),
                    layers: flaggedLayers,
                });
            }
        }
        return nearMisses;
    }
}
