/**
 * RuvBot Swarm - First Flight (Phase 5)
 * PRD Reference: PRD.md v1.0.0 — Section 4 (Lean Build), Section 6 (Data Flow)
 *
 * Wires the full stack: AIDefenceCoordinator + SwarmOrchestrator.
 * Proves agents can collaborate while the Kill Switch enforces L1-L3 security.
 *
 * Flow:
 *   1. Initialize coordinator (6-layer AIDefence) + orchestrator
 *   2. Register Architect + Worker agents
 *   3. Architect dispatches a clean design task to Worker → HandoffRecord logged
 *   4. Simulate an injected message → SecurityViolationError caught + threat reported
 */
import { ThreatLevel } from './security/coordinator.js';
import { type SwarmMessage, type HandoffRecord, type IMCPBridge } from './swarm/orchestrator.js';
export interface FlightLog {
    handoffs: HandoffRecord[];
    violations: Array<{
        messageId: string;
        from: string;
        to: string;
        blockReason: string;
        threatScore: number;
        verdict: ThreatLevel;
        timestamp: number;
    }>;
    totalDispatches: number;
    totalBlocked: number;
    elapsedMs: number;
}
/**
 * MCP Bridge that records audit calls for monitoring.
 * In production, these would call the real Claude-Flow MCP tools:
 *   agent_spawn, agent_terminate, memory_store
 */
export declare class RecordingMCPBridge implements IMCPBridge {
    readonly auditLog: Array<{
        key: string;
        value: string;
        namespace?: string;
    }>;
    spawnAgent(config: {
        agentType: string;
        agentId?: string;
    }): Promise<string>;
    terminateAgent(): Promise<void>;
    storeMemory(key: string, value: string, namespace?: string): Promise<void>;
}
export declare function createMessage(from: SwarmMessage['from'], to: SwarmMessage['to'], content: string, metadata?: Record<string, unknown>): SwarmMessage;
export declare function firstFlight(): Promise<FlightLog>;
/**
 * Live-wired variant of firstFlight() using NeuralLiveMCPClient.
 * L2 uses the local HNSW Neural Shield via VectorScanner.
 * L1/L3/L4 call real MCP tools via callTool (placeholder until Phase 8).
 */
export declare function firstFlightLive(): Promise<FlightLog>;
