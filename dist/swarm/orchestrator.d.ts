/**
 * RuvBot Swarm - SwarmOrchestrator
 * PRD Reference: PRD.md v1.1.0 — Section 4 (Lean Build), Section 6 (Data Flow)
 *
 * The central dispatch hub. Every message between agents passes through the
 * AIDefenceCoordinator before delivery. Blocked messages throw a
 * SecurityViolationError — the "Kill Switch".
 *
 * Phase 12a: RVF-native integrity. Every handoff is recorded as a SHAKE-256
 * witness entry in the .rvf Bunker file via the IRVFBridge interface.
 * This replaces the earlier HMAC message chain prototype.
 *
 * Designed by: PAL Bridge (gemini-3-pro-preview)
 * Supports: Claude-Flow V3 MCP toolset + RVF MCP server
 */
import { AIDefenceCoordinator, DefenceResult } from '../security/coordinator.js';
export type AgentRole = 'architect' | 'worker' | 'reviewer';
/** RVF witness types (maps to WITNESS_SEG discriminators in rvf-types) */
export declare enum WitnessType {
    PROVENANCE = 1,
    COMPUTATION = 2,
    SEARCH = 3,
    DELETION = 4
}
export interface SwarmMessage {
    id: string;
    from: AgentRole;
    to: AgentRole;
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
    /** ID of the previous message in this agent's chain */
    previousMessageId?: string;
}
export interface HandoffRecord {
    messageId: string;
    from: AgentRole;
    to: AgentRole;
    defenceResult: DefenceResult;
    deliveredContent: string;
    timestamp: number;
    /** Content-addressed hash of the handoff (sha256 of deliveredContent) */
    contentHash: string;
    /** Whether this handoff was recorded in the RVF witness chain */
    witnessRecorded?: boolean;
}
/**
 * Generates a content-addressed hash for a piece of content.
 * Used as the action_hash basis for RVF witness entries.
 */
export declare function contentHash(content: string): string;
export interface AgentEntry {
    id: string;
    role: AgentRole;
    status: 'active' | 'idle' | 'terminated';
    spawnedAt: number;
}
export interface OrchestratorConfig {
    maxAgents: number;
    auditNamespace: string;
    ledgerNamespace: string;
    enableAudit: boolean;
    enableLedger: boolean;
}
export declare const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig;
/**
 * Abstraction over Claude-Flow V3 MCP tools.
 * Maps to: agent_spawn, agent_terminate, memory_store.
 * Injectable for testing.
 */
export interface IMCPBridge {
    spawnAgent(config: {
        agentType: string;
        agentId?: string;
    }): Promise<string>;
    terminateAgent(agentId: string): Promise<void>;
    storeMemory(key: string, value: string, namespace?: string): Promise<void>;
}
export declare class StubMCPBridge implements IMCPBridge {
    spawnAgent(config: {
        agentType: string;
        agentId?: string;
    }): Promise<string>;
    terminateAgent(): Promise<void>;
    storeMemory(): Promise<void>;
}
/**
 * Abstraction over the RVF MCP server tools.
 * Maps to: rvf_create_store, rvf_ingest, rvf_query, rvf_status.
 * The witness chain is recorded via ingest of witness vectors.
 * Injectable for testing.
 */
export interface IRVFBridge {
    /**
     * Record a witness entry in the .rvf Bunker file.
     * Maps to an rvf_ingest call with witness metadata.
     */
    recordWitness(entry: {
        witnessType: WitnessType;
        actionHash: string;
        metadata: Record<string, unknown>;
    }): Promise<void>;
    /**
     * Query the RVF store status (segment count, witness chain length).
     */
    getStatus(): Promise<{
        vectorCount: number;
        segmentCount: number;
    }>;
}
export declare class StubRVFBridge implements IRVFBridge {
    readonly witnessLog: Array<{
        witnessType: WitnessType;
        actionHash: string;
        metadata: Record<string, unknown>;
    }>;
    recordWitness(entry: {
        witnessType: WitnessType;
        actionHash: string;
        metadata: Record<string, unknown>;
    }): Promise<void>;
    getStatus(): Promise<{
        vectorCount: number;
        segmentCount: number;
    }>;
}
export declare class SecurityViolationError extends Error {
    readonly blockReason: string;
    readonly defenceResult: DefenceResult;
    constructor(reason: string, result: DefenceResult);
}
export declare class SwarmOrchestrator {
    private readonly coordinator;
    private readonly bridge;
    private readonly rvf;
    private readonly config;
    private readonly agents;
    /** Tracks the last message ID per agent role for chain linking */
    private readonly lastMessageByRole;
    constructor(coordinator: AIDefenceCoordinator, config?: Partial<OrchestratorConfig>, bridge?: IMCPBridge, rvfBridge?: IRVFBridge);
    registerAgent(id: string, role: AgentRole): AgentEntry;
    unregisterAgent(id: string): boolean;
    getAgent(id: string): AgentEntry | undefined;
    getAgentsByRole(role: AgentRole): AgentEntry[];
    getActiveAgents(): AgentEntry[];
    /**
     * Every inter-agent message passes through here.
     * 1. Run content through 6-layer AIDefence
     * 2. If blocked → throw SecurityViolationError (Kill Switch)
     * 3. If safe → build HandoffRecord with content hash
     * 4. Fire audit to L6 trail (async, non-blocking)
     * 5. Write to decision_ledger (async, non-blocking)
     * 6. Record RVF witness entry (async, non-blocking)
     */
    dispatch(message: SwarmMessage): Promise<HandoffRecord>;
    /** Returns the last message ID sent by a given role (for chain linking). */
    getLastMessageId(role: AgentRole): string | undefined;
    auditHandoff(record: HandoffRecord): Promise<void>;
    /**
     * Writes a content-addressed entry to the decision ledger.
     * Key is sha256(deliveredContent) — guarantees deduplication and tamper evidence.
     */
    writeLedgerEntry(record: HandoffRecord): Promise<void>;
    /**
     * Records a PROVENANCE witness entry in the RVF Bunker file.
     * The action_hash is the content-addressed hash of the delivered content.
     * Each entry is hash-linked to the previous entry (SHAKE-256) by the
     * RVF runtime, forming an immutable, tamper-evident chain.
     */
    recordRVFWitness(record: HandoffRecord): Promise<void>;
    shutdown(): Promise<void>;
}
