/**
 * RuvBot Swarm - Security Explorer
 * PRD Reference: PRD.md v1.0.0 — Section 5.5 (L5 Adaptive Learning)
 *
 * Queries the swarm_audit namespace for 'Near-Miss' handoffs:
 * messages that scored 0.7 ≤ score < 0.9 (FLAGGED but not BLOCKED).
 * These are the most valuable signals for adaptive learning.
 */
import type { DefenceResult } from './coordinator.js';
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
export declare const DEFAULT_NEAR_MISS_CONFIG: NearMissConfig;
/**
 * Abstraction over the audit data backend.
 * In production: reads from claude-flow memory_list + memory_retrieve.
 * In tests: backed by an in-memory array.
 */
export interface IAuditStore {
    listRecords(namespace: string): Promise<AuditRecord[]>;
}
export declare class InMemoryAuditStore implements IAuditStore {
    private records;
    addRecord(record: AuditRecord): void;
    listRecords(_namespace: string): Promise<AuditRecord[]>;
}
export declare class SecurityExplorer {
    private store;
    private config;
    private namespace;
    constructor(store: IAuditStore, namespace?: string, config?: Partial<NearMissConfig>);
    /**
     * Find all near-miss handoffs: 0.7 ≤ maxLayerScore < 0.9.
     * These are FLAGGED messages that almost triggered the Kill Switch.
     */
    findNearMisses(): Promise<NearMiss[]>;
}
