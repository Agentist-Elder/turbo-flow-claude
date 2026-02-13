/**
 * RuvBot Swarm - SwarmOrchestrator
 * PRD Reference: PRD.md v1.0.0 — Section 4 (Lean Build), Section 6 (Data Flow)
 *
 * The central dispatch hub. Every message between agents passes through the
 * AIDefenceCoordinator before delivery. Blocked messages throw a
 * SecurityViolationError — the "Kill Switch".
 *
 * Designed by: PAL Bridge (gemini-3-pro-preview)
 * Supports: Claude-Flow V3 MCP toolset (agent_spawn, agent_terminate, memory_store)
 */
import { AIDefenceCoordinator, DefenceResult } from '../security/coordinator.js';
export type AgentRole = 'architect' | 'worker' | 'reviewer';
export interface SwarmMessage {
    id: string;
    from: AgentRole;
    to: AgentRole;
    content: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
}
export interface HandoffRecord {
    messageId: string;
    from: AgentRole;
    to: AgentRole;
    defenceResult: DefenceResult;
    deliveredContent: string;
    timestamp: number;
}
export interface AgentEntry {
    id: string;
    role: AgentRole;
    status: 'active' | 'idle' | 'terminated';
    spawnedAt: number;
}
export interface OrchestratorConfig {
    maxAgents: number;
    auditNamespace: string;
    enableAudit: boolean;
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
export declare class SecurityViolationError extends Error {
    readonly blockReason: string;
    readonly defenceResult: DefenceResult;
    constructor(reason: string, result: DefenceResult);
}
export declare class SwarmOrchestrator {
    private readonly coordinator;
    private readonly bridge;
    private readonly config;
    private readonly agents;
    constructor(coordinator: AIDefenceCoordinator, config?: Partial<OrchestratorConfig>, bridge?: IMCPBridge);
    registerAgent(id: string, role: AgentRole): AgentEntry;
    unregisterAgent(id: string): boolean;
    getAgent(id: string): AgentEntry | undefined;
    getAgentsByRole(role: AgentRole): AgentEntry[];
    getActiveAgents(): AgentEntry[];
    /**
     * Every inter-agent message passes through here.
     * 1. Run content through 6-layer AIDefence
     * 2. If blocked → throw SecurityViolationError (Kill Switch)
     * 3. If safe → build HandoffRecord with sanitized content
     * 4. Fire audit to L6 trail (async, non-blocking)
     */
    dispatch(message: SwarmMessage): Promise<HandoffRecord>;
    auditHandoff(record: HandoffRecord): Promise<void>;
    shutdown(): Promise<void>;
}
