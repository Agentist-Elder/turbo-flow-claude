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
/** RVF witness types (maps to WITNESS_SEG discriminators in rvf-types) */
export var WitnessType;
(function (WitnessType) {
    WitnessType[WitnessType["PROVENANCE"] = 1] = "PROVENANCE";
    WitnessType[WitnessType["COMPUTATION"] = 2] = "COMPUTATION";
    WitnessType[WitnessType["SEARCH"] = 3] = "SEARCH";
    WitnessType[WitnessType["DELETION"] = 4] = "DELETION";
})(WitnessType || (WitnessType = {}));
// ── Content Hashing ─────────────────────────────────────────────────
/**
 * Generates a content-addressed hash for a piece of content.
 * Used as the action_hash basis for RVF witness entries.
 */
export function contentHash(content) {
    return createHash('sha256').update(content).digest('hex');
}
export const DEFAULT_ORCHESTRATOR_CONFIG = {
    maxAgents: 10,
    auditNamespace: 'swarm_audit',
    ledgerNamespace: 'decision_ledger',
    enableAudit: true,
    enableLedger: true,
};
export class StubMCPBridge {
    async spawnAgent(config) {
        return config.agentId ?? randomUUID();
    }
    async terminateAgent() { }
    async storeMemory() { }
}
export class StubRVFBridge {
    witnessLog = [];
    async recordWitness(entry) {
        this.witnessLog.push(entry);
    }
    async getStatus() {
        return { vectorCount: this.witnessLog.length, segmentCount: 0 };
    }
}
// ── Custom Errors ────────────────────────────────────────────────────
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
    rvf;
    config;
    agents = new Map();
    /** Tracks the last message ID per agent role for chain linking */
    lastMessageByRole = new Map();
    constructor(coordinator, config = {}, bridge, rvfBridge) {
        this.coordinator = coordinator;
        this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
        this.bridge = bridge ?? new StubMCPBridge();
        this.rvf = rvfBridge ?? new StubRVFBridge();
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
     * 3. If safe → build HandoffRecord with content hash
     * 4. Fire audit to L6 trail (async, non-blocking)
     * 5. Write to decision_ledger (async, non-blocking)
     * 6. Record RVF witness entry (async, non-blocking)
     */
    async dispatch(message) {
        // 1. Gate through AIDefence
        const defenceResult = await this.coordinator.processRequest(message.content);
        // 2. Kill Switch
        if (defenceResult.is_blocked) {
            throw new SecurityViolationError(defenceResult.block_reason ?? 'Blocked by AIDefence', defenceResult);
        }
        // 3. Build handoff with sanitized content + content-addressed hash
        const hash = contentHash(defenceResult.safe_input);
        const record = {
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
    getLastMessageId(role) {
        return this.lastMessageByRole.get(role);
    }
    // ── Audit ───────────────────────────────────────────────────────────
    async auditHandoff(record) {
        const key = `handoff:${record.messageId}`;
        const value = JSON.stringify(record);
        await this.bridge.storeMemory(key, value, this.config.auditNamespace);
    }
    /**
     * Writes a content-addressed entry to the decision ledger.
     * Key is sha256(deliveredContent) — guarantees deduplication and tamper evidence.
     */
    async writeLedgerEntry(record) {
        const entry = {
            messageId: record.messageId,
            from: record.from,
            to: record.to,
            contentHash: record.contentHash,
            verdict: record.defenceResult.verdict,
            timestamp: record.timestamp,
        };
        await this.bridge.storeMemory(`ledger:${record.contentHash}`, JSON.stringify(entry), this.config.ledgerNamespace);
    }
    // ── RVF Witness Chain ─────────────────────────────────────────────
    /**
     * Records a PROVENANCE witness entry in the RVF Bunker file.
     * The action_hash is the content-addressed hash of the delivered content.
     * Each entry is hash-linked to the previous entry (SHAKE-256) by the
     * RVF runtime, forming an immutable, tamper-evident chain.
     */
    async recordRVFWitness(record) {
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
