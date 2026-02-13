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
export const DEFAULT_ORCHESTRATOR_CONFIG = {
    maxAgents: 10,
    auditNamespace: 'swarm_audit',
    enableAudit: true,
};
export class StubMCPBridge {
    async spawnAgent(config) {
        return config.agentId ?? randomUUID();
    }
    async terminateAgent() { }
    async storeMemory() { }
}
// ── Custom Error ─────────────────────────────────────────────────────
export class SecurityViolationError extends Error {
    blockReason;
    defenceResult;
    constructor(reason, result) {
        super(`Security Violation: ${reason}`);
        this.name = 'SecurityViolationError';
        this.blockReason = reason;
        this.defenceResult = result;
    }
}
// ── SwarmOrchestrator ────────────────────────────────────────────────
export class SwarmOrchestrator {
    coordinator;
    bridge;
    config;
    agents = new Map();
    constructor(coordinator, config = {}, bridge) {
        this.coordinator = coordinator;
        this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
        this.bridge = bridge ?? new StubMCPBridge();
    }
    // ── Agent Registry ──────────────────────────────────────────────────
    registerAgent(id, role) {
        if (this.agents.has(id)) {
            throw new Error(`Agent '${id}' already registered`);
        }
        if (this.agents.size >= this.config.maxAgents) {
            throw new Error(`Agent limit reached (${this.config.maxAgents})`);
        }
        const entry = {
            id,
            role,
            status: 'idle',
            spawnedAt: Date.now(),
        };
        this.agents.set(id, entry);
        return entry;
    }
    unregisterAgent(id) {
        return this.agents.delete(id);
    }
    getAgent(id) {
        return this.agents.get(id);
    }
    getAgentsByRole(role) {
        return Array.from(this.agents.values()).filter(a => a.role === role);
    }
    getActiveAgents() {
        return Array.from(this.agents.values()).filter(a => a.status === 'active' || a.status === 'idle');
    }
    // ── Core Dispatch (The Kill Switch) ─────────────────────────────────
    /**
     * Every inter-agent message passes through here.
     * 1. Run content through 6-layer AIDefence
     * 2. If blocked → throw SecurityViolationError (Kill Switch)
     * 3. If safe → build HandoffRecord with sanitized content
     * 4. Fire audit to L6 trail (async, non-blocking)
     */
    async dispatch(message) {
        // 1. Gate through AIDefence
        const defenceResult = await this.coordinator.processRequest(message.content);
        // 2. Kill Switch
        if (defenceResult.is_blocked) {
            throw new SecurityViolationError(defenceResult.block_reason ?? 'Blocked by AIDefence', defenceResult);
        }
        // 3. Build handoff with sanitized content
        const record = {
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
    async auditHandoff(record) {
        const key = `handoff:${record.messageId}`;
        const value = JSON.stringify(record);
        await this.bridge.storeMemory(key, value, this.config.auditNamespace);
    }
    // ── Lifecycle ───────────────────────────────────────────────────────
    async shutdown() {
        const active = this.getActiveAgents();
        await Promise.all(active.map(async (agent) => {
            try {
                await this.bridge.terminateAgent(agent.id);
                agent.status = 'terminated';
            }
            catch (err) {
                console.error(`[Orchestrator] Failed to terminate ${agent.id}:`, err);
            }
        }));
        this.agents.clear();
    }
}
