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

import { randomUUID } from 'crypto';
import {
  AIDefenceCoordinator,
  DefenceResult,
} from '../security/coordinator.js';

// ── Types ────────────────────────────────────────────────────────────

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

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxAgents: 10,
  auditNamespace: 'swarm_audit',
  enableAudit: true,
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

// ── Custom Error ─────────────────────────────────────────────────────

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
  private readonly config: OrchestratorConfig;
  private readonly agents: Map<string, AgentEntry> = new Map();

  constructor(
    coordinator: AIDefenceCoordinator,
    config: Partial<OrchestratorConfig> = {},
    bridge?: IMCPBridge,
  ) {
    this.coordinator = coordinator;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.bridge = bridge ?? new StubMCPBridge();
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
   * 3. If safe → build HandoffRecord with sanitized content
   * 4. Fire audit to L6 trail (async, non-blocking)
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

    // 3. Build handoff with sanitized content
    const record: HandoffRecord = {
      messageId: message.id,
      from: message.from,
      to: message.to,
      defenceResult,
      deliveredContent: defenceResult.safe_input,
      timestamp: Date.now(),
    };

    // 4. L6 Audit (fire-and-forget)
    if (this.config.enableAudit) {
      this.auditHandoff(record).catch(err => {
        console.error(`[Orchestrator] Audit failed for ${message.id}:`, err);
      });
    }

    return record;
  }

  // ── Audit ───────────────────────────────────────────────────────────

  async auditHandoff(record: HandoffRecord): Promise<void> {
    const key = `handoff:${record.messageId}`;
    const value = JSON.stringify(record);
    await this.bridge.storeMemory(key, value, this.config.auditNamespace);
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
