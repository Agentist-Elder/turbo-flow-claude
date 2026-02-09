/**
 * RuvBot Swarm - Security Explorer
 * PRD Reference: PRD.md v1.0.0 — Section 5.5 (L5 Adaptive Learning)
 *
 * Queries the swarm_audit namespace for 'Near-Miss' handoffs:
 * messages that scored 0.7 ≤ score < 0.9 (FLAGGED but not BLOCKED).
 * These are the most valuable signals for adaptive learning.
 */

import type { DefenceResult } from './coordinator.js';

// ── Types ────────────────────────────────────────────────────────────

export interface AuditRecord {
  messageId: string;
  from: string;
  to: string;
  defenceResult: DefenceResult;
  deliveredContent: string;
  timestamp: number;
}

export interface NearMiss {
  record: AuditRecord;
  score: number;
  layers: string[];
}

export interface NearMissConfig {
  minScore: number;
  maxScore: number;
}

export const DEFAULT_NEAR_MISS_CONFIG: NearMissConfig = {
  minScore: 0.7,
  maxScore: 0.9,
};

// ── Audit Store Interface ────────────────────────────────────────────

/**
 * Abstraction over the audit data backend.
 * In production: reads from claude-flow memory_list + memory_retrieve.
 * In tests: backed by an in-memory array.
 */
export interface IAuditStore {
  listRecords(namespace: string): Promise<AuditRecord[]>;
}

export class InMemoryAuditStore implements IAuditStore {
  private records: AuditRecord[] = [];

  addRecord(record: AuditRecord): void {
    this.records.push(record);
  }

  async listRecords(_namespace: string): Promise<AuditRecord[]> {
    return [...this.records];
  }
}

// ── Security Explorer ────────────────────────────────────────────────

export class SecurityExplorer {
  private store: IAuditStore;
  private config: NearMissConfig;
  private namespace: string;

  constructor(
    store: IAuditStore,
    namespace = 'swarm_audit',
    config: Partial<NearMissConfig> = {},
  ) {
    this.store = store;
    this.namespace = namespace;
    this.config = { ...DEFAULT_NEAR_MISS_CONFIG, ...config };
  }

  /**
   * Find all near-miss handoffs: 0.7 ≤ maxLayerScore < 0.9.
   * These are FLAGGED messages that almost triggered the Kill Switch.
   */
  async findNearMisses(): Promise<NearMiss[]> {
    const records = await this.store.listRecords(this.namespace);
    const nearMisses: NearMiss[] = [];

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
