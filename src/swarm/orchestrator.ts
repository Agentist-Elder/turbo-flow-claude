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

import { randomUUID, createHash } from 'crypto';
import {
  AIDefenceCoordinator,
  DefenceResult,
} from '../security/coordinator.js';

// ── Types ────────────────────────────────────────────────────────────

export type AgentRole = 'architect' | 'worker' | 'reviewer';

/** RVF witness types (maps to WITNESS_SEG discriminators in rvf-types) */
export enum WitnessType {
  PROVENANCE = 0x01,
  COMPUTATION = 0x02,
  SEARCH = 0x03,
  DELETION = 0x04,
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

// ── Content Hashing ─────────────────────────────────────────────────

/**
 * Generates a content-addressed hash for a piece of content.
 * Used as the action_hash basis for RVF witness entries.
 */
export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ── Agent & Config ──────────────────────────────────────────────────

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

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxAgents: 10,
  auditNamespace: 'swarm_audit',
  ledgerNamespace: 'decision_ledger',
  enableAudit: true,
  enableLedger: true,
};

// ── MCP Bridge Interface ─────────────────────────────────────────────

/**
 * Abstraction over Claude-Flow V3 MCP tools.
 * Maps to: agent_spawn, agent_terminate, memory_store.
 * Injectable for testing.
 */
export interface IMCPBridge {
  spawnAgent(config: { agentType: string; agentId?: string }): Promise<string>;
  terminateAgent(agentId: string): Promise<void>;
  storeMemory(key: string, value: string, namespace?: string): Promise<void>;
}

export class StubMCPBridge implements IMCPBridge {
  async spawnAgent(config: { agentType: string; agentId?: string }): Promise<string> {
    return config.agentId ?? randomUUID();
  }
  async terminateAgent(): Promise<void> { /* no-op */ }
  async storeMemory(): Promise<void> { /* no-op */ }
}

// ── RVF Witness Bridge Interface ─────────────────────────────────────

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
  getStatus(): Promise<{ vectorCount: number; segmentCount: number }>;
}

export class StubRVFBridge implements IRVFBridge {
  public readonly witnessLog: Array<{
    witnessType: WitnessType;
    actionHash: string;
    metadata: Record<string, unknown>;
  }> = [];

  async recordWitness(entry: {
    witnessType: WitnessType;
    actionHash: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    this.witnessLog.push(entry);
  }

  async getStatus(): Promise<{ vectorCount: number; segmentCount: number }> {
    return { vectorCount: this.witnessLog.length, segmentCount: 0 };
  }
}

// ── Custom Errors ────────────────────────────────────────────────────

export class SecurityViolationError extends Error {
  public readonly blockReason: string;
  public readonly defenceResult: DefenceResult;

  constructor(reason: string, result: DefenceResult) {
    super(`Security Violation: ${reason}`);
    this.name = 'SecurityViolationError';
    this.blockReason = reason;
    this.defenceResult = result;
  }
}

// ── SwarmOrchestrator ────────────────────────────────────────────────

export class SwarmOrchestrator {
  private readonly coordinator: AIDefenceCoordinator;
  private readonly bridge: IMCPBridge;
  private readonly rvf: IRVFBridge;
  private readonly config: OrchestratorConfig;
  private readonly agents: Map<string, AgentEntry> = new Map();
  /** Tracks the last message ID per agent role for chain linking */
  private readonly lastMessageByRole: Map<AgentRole, string> = new Map();

  constructor(
    coordinator: AIDefenceCoordinator,
    config: Partial<OrchestratorConfig> = {},
    bridge?: IMCPBridge,
    rvfBridge?: IRVFBridge,
  ) {
    this.coordinator = coordinator;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.bridge = bridge ?? new StubMCPBridge();
    this.rvf = rvfBridge ?? new StubRVFBridge();
  }

  // ── Agent Registry ──────────────────────────────────────────────────

  registerAgent(id: string, role: AgentRole): AgentEntry {
    if (this.agents.has(id)) {
      throw new Error(`Agent '${id}' already registered`);
    }
    if (this.agents.size >= this.config.maxAgents) {
      throw new Error(`Agent limit reached (${this.config.maxAgents})`);
    }

    const entry: AgentEntry = {
      id,
      role,
      status: 'idle',
      spawnedAt: Date.now(),
    };
    this.agents.set(id, entry);
    return entry;
  }

  unregisterAgent(id: string): boolean {
    return this.agents.delete(id);
  }

  getAgent(id: string): AgentEntry | undefined {
    return this.agents.get(id);
  }

  getAgentsByRole(role: AgentRole): AgentEntry[] {
    return Array.from(this.agents.values()).filter(a => a.role === role);
  }

  getActiveAgents(): AgentEntry[] {
    return Array.from(this.agents.values()).filter(
      a => a.status === 'active' || a.status === 'idle',
    );
  }

  // ── Core Dispatch (The Kill Switch) ─────────────────────────────────

  /**
   * Every inter-agent message passes through here.
   * 1. Run content through 6-layer AIDefence
   * 2. If blocked → throw SecurityViolationError (Kill Switch)
   * 3. If safe → build HandoffRecord with content hash
   * 4. Fire audit to L6 trail (async, non-blocking)
   * 5. Write to decision_ledger (async, non-blocking)
   * 6. Record RVF witness entry (async, non-blocking)
   */
  async dispatch(message: SwarmMessage): Promise<HandoffRecord> {
    // 1. Gate through AIDefence
    const defenceResult = await this.coordinator.processRequest(message.content);

    // 2. Kill Switch
    if (defenceResult.is_blocked) {
      throw new SecurityViolationError(
        defenceResult.block_reason ?? 'Blocked by AIDefence',
        defenceResult,
      );
    }

    // 3. Build handoff with sanitized content + content-addressed hash
    const hash = contentHash(defenceResult.safe_input);
    const record: HandoffRecord = {
      messageId: message.id,
      from: message.from,
      to: message.to,
      defenceResult,
      deliveredContent: defenceResult.safe_input,
      timestamp: Date.now(),
      contentHash: hash,
    };

    // Update chain tracker
    this.lastMessageByRole.set(message.from, message.id);

    // 4. L6 Audit (fire-and-forget)
    if (this.config.enableAudit) {
      this.auditHandoff(record).catch(err => {
        console.error(`[Orchestrator] Audit failed for ${message.id}:`, err);
      });
    }

    // 5. Decision ledger (fire-and-forget, content-addressed)
    if (this.config.enableLedger) {
      this.writeLedgerEntry(record).catch(err => {
        console.error(`[Orchestrator] Ledger write failed for ${message.id}:`, err);
      });
    }

    // 6. RVF witness (fire-and-forget, SHAKE-256 chain in .rvf file)
    this.recordRVFWitness(record).catch(err => {
      console.error(`[Orchestrator] RVF witness failed for ${message.id}:`, err);
    });

    return record;
  }

  /** Returns the last message ID sent by a given role (for chain linking). */
  getLastMessageId(role: AgentRole): string | undefined {
    return this.lastMessageByRole.get(role);
  }

  // ── Audit ───────────────────────────────────────────────────────────

  async auditHandoff(record: HandoffRecord): Promise<void> {
    const key = `handoff:${record.messageId}`;
    const value = JSON.stringify(record);
    await this.bridge.storeMemory(key, value, this.config.auditNamespace);
  }

  /**
   * Writes a content-addressed entry to the decision ledger.
   * Key is sha256(deliveredContent) — guarantees deduplication and tamper evidence.
   */
  async writeLedgerEntry(record: HandoffRecord): Promise<void> {
    const entry = {
      messageId: record.messageId,
      from: record.from,
      to: record.to,
      contentHash: record.contentHash,
      verdict: record.defenceResult.verdict,
      timestamp: record.timestamp,
    };
    await this.bridge.storeMemory(
      `ledger:${record.contentHash}`,
      JSON.stringify(entry),
      this.config.ledgerNamespace,
    );
  }

  // ── RVF Witness Chain ─────────────────────────────────────────────

  /**
   * Records a PROVENANCE witness entry in the RVF Bunker file.
   * The action_hash is the content-addressed hash of the delivered content.
   * Each entry is hash-linked to the previous entry (SHAKE-256) by the
   * RVF runtime, forming an immutable, tamper-evident chain.
   */
  async recordRVFWitness(record: HandoffRecord): Promise<void> {
    await this.rvf.recordWitness({
      witnessType: WitnessType.PROVENANCE,
      actionHash: record.contentHash,
      metadata: {
        messageId: record.messageId,
        from: record.from,
        to: record.to,
        verdict: record.defenceResult.verdict,
        timestamp: record.timestamp,
      },
    });
    record.witnessRecorded = true;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    const active = this.getActiveAgents();

    await Promise.all(
      active.map(async agent => {
        try {
          await this.bridge.terminateAgent(agent.id);
          agent.status = 'terminated';
        } catch (err) {
          console.error(`[Orchestrator] Failed to terminate ${agent.id}:`, err);
        }
      }),
    );

    this.agents.clear();
  }
}
