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
import { MCPTransportAdapter } from './security/mcp-transport.js';
import { WitnessType, type SwarmMessage, type HandoffRecord, type IMCPBridge, type IRVFBridge } from './swarm/orchestrator.js';
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
/**
 * Connects to the RVF MCP server and implements IRVFBridge
 * by calling rvf_create_store and rvf_ingest over MCP.
 *
 * Unlike the StubRVFBridge, this writes real witness vectors into
 * the bunker.rvf store via the live RVF MCP server process.
 */
export declare class LiveRVFBridge implements IRVFBridge {
    private adapter;
    private storeId;
    private dimensions;
    private scrub;
    constructor(adapter: MCPTransportAdapter, scrubber?: (text: string) => string);
    initialize(storePath: string): Promise<void>;
    recordWitness(entry: {
        witnessType: WitnessType;
        actionHash: string;
        metadata: Record<string, unknown>;
    }): Promise<void>;
    getStatus(): Promise<{
        vectorCount: number;
        segmentCount: number;
    }>;
    /** Convert a hex hash string to a normalized float vector. */
    private hashToVector;
}
/**
 * Fetches each URL with Node.js fetch(), strips HTML, saves to a temp file.
 * Returns structured records including SHA-256 of the fetched text so citations
 * can be pinned to the state of the source at research time.
 * Failures are non-fatal — a warning is logged and the URL is skipped.
 */
export interface FetchedSource {
    url: string;
    filePath: string;
    sha256: string;
    fetchedAt: string;
    charCount: number;
}
export type TsaTier = 'DigiCert' | 'Sectigo' | 'local';
export interface TsaAttestation {
    tier: TsaTier;
    timestamp: string;
    manifestText: string;
    manifestHash: string;
    tsrBase64?: string;
    localHmac?: string;
    verifyCommand?: string;
}
export declare function runGoal(goal: string, opts?: {
    allowSecurityResearch?: boolean;
    fetchUrls?: string[];
}): Promise<FlightLog>;
