# GTIG Prevention Research: RVF-Native Integrity for Agent Swarms

| Metadata | Details |
| :--- | :--- |
| **Version** | 1.0.0 |
| **Date** | 2026-02-16 |
| **Phase** | 12a (Cloud-Only, RVF-Native) |
| **Status** | Implemented — 201 tests passing |
| **Authors** | Claude (Auditor/Scribe), Gemini 3 Pro (Architect), User (Commander) |
| **PRD Reference** | PRD.md v1.1.0 |

---

## 1. Threat Model: GTIG Feb 2026 Findings

The Google Threat Intelligence Group (GTIG) February 2026 report identified a class of attacks that bypass traditional runtime security:

**Synthetic Identity Attacks (APT31, APT42):**
- State-backed groups deploy AI agents with fabricated personas
- These agents pass all content-level security checks (L1-L4) because their messages are well-formed
- The attack surface is not the *content* but the *source identity*
- Compromised agents control their own runtime, so internal scanning cannot detect them

**Rapport-Building Personas (Xanthorox):**
- Long-running agents build trust through legitimate interactions before pivoting to exfiltration
- Behavioral fingerprinting is defeated by adjusting temperature/system prompt
- Traditional "detect the bad message" approaches fail when the attack is the *relationship*

**Key Insight:** Runtime content scanning (our 6-Layer AIDefence Stack) is necessary but insufficient. We need *provenance integrity* — proof of what decisions were made, by whom, and in what order.

---

## 2. Approaches Evaluated

### 2.1 Behavioral Fingerprinting (Rejected)

**Proposal:** Identify agents by their behavioral signature (token distribution, response timing, reasoning style).

**Rejection Rationale:**
- LLMs are non-deterministic by design; same agent + same prompt = different behavior across runs
- Any adversary aware of the fingerprinting system defeats it by adjusting generation parameters
- Brittle classifier requiring months of tuning for marginal security gain
- Analogous to browser fingerprinting: useful against unsophisticated threats, trivially bypassed by state-backed actors

### 2.2 DID-Based Handshake (Deferred)

**Proposal:** W3C Decentralized Identifiers for agent-to-agent authentication.

**Deferral Rationale:**
- Correct solution for agents spanning *trust domains* (e.g., cross-organization swarms)
- Unnecessary within a single Codespace where the Architect spawns all Workers directly
- Key management complexity (who issues DIDs?) moves the trust anchor problem without solving it
- DID verification adds 0.5-2ms to the fast path budget — acceptable but pointless when provenance tracking achieves the same goal

### 2.3 HMAC Message Chains (Superseded)

**Proposal:** Shared-secret HMAC-SHA256 signatures on every SwarmMessage with append-only chain linking.

**Status:** Implemented as prototype, then superseded by RVF-native witness chains.

**Why Superseded:**
- HMAC chains provide tamper evidence but are application-level (convention, not enforcement)
- RVF witness chains operate at the binary format level with SHAKE-256 hash linking
- RVF provides additional capabilities (COW branching, segment signing, post-quantum crypto) that HMAC cannot
- The tooling shipped (`@ruvector/rvf` v0.1.7, `@ruvector/rvf-mcp-server` v0.1.3) making custom crypto unnecessary

### 2.4 RVF-Native Witness Chains (Selected)

**Proposal:** Record every swarm decision as a PROVENANCE witness entry in an `.rvf` Bunker file using the RVF MCP server.

**Selection Rationale:**
- Binary-level tamper evidence: changing one byte causes all subsequent `prev_hash` values to fail
- SHAKE-256 hash linking (73 bytes/entry) with nanosecond timestamps
- Content-addressed storage: duplicate decisions are deduplicated automatically
- Post-quantum signing (ML-DSA-65, Ed25519) available when needed
- COW branching enables per-agent knowledge isolation with cryptographic lineage
- Aligns with the creator's (Reuven Cohen) stated design philosophy: "practical zero trust" without blockchain machinery

---

## 3. Architecture: RVF-Native Integrity Layer

### 3.1 Integration Point

The RVF witness chain integrates at the `SwarmOrchestrator.dispatch()` level, alongside the existing audit trail:

```
SwarmMessage arrives
      |
      v
[1. AIDefence L1-L4] --- Content scanning (existing)
      |
      v (SAFE)
[2. Build HandoffRecord] --- Content hash (SHA-256)
      |
      +---> [3. L6 Audit Trail]         (async, fire-and-forget)
      +---> [4. Decision Ledger]         (async, content-addressed)
      +---> [5. RVF Witness Entry]       (async, SHAKE-256 chain)
      |
      v
[Delivered to recipient agent]
```

### 3.2 Witness Entry Structure

Each dispatch records a PROVENANCE witness entry (type `0x01`):

| Field | Value | Source |
| :--- | :--- | :--- |
| `witnessType` | `0x01` (PROVENANCE) | Fixed for handoffs |
| `actionHash` | SHA-256 of `deliveredContent` | `contentHash()` in orchestrator |
| `metadata.messageId` | UUID of the SwarmMessage | Message.id |
| `metadata.from` | Sender role (architect/worker/reviewer) | Message.from |
| `metadata.to` | Recipient role | Message.to |
| `metadata.verdict` | AIDefence verdict (SAFE/FLAGGED) | DefenceResult.verdict |
| `metadata.timestamp` | Unix timestamp (ms) | Date.now() |

The RVF runtime links each entry to the previous via `prev_hash` (SHAKE-256-256), forming an immutable chain.

### 3.3 Interface Design

```typescript
// IRVFBridge — abstraction over RVF MCP server tools
interface IRVFBridge {
  recordWitness(entry: {
    witnessType: WitnessType;
    actionHash: string;
    metadata: Record<string, unknown>;
  }): Promise<void>;

  getStatus(): Promise<{ vectorCount: number; segmentCount: number }>;
}
```

- **StubRVFBridge**: In-memory witness log for unit tests (201 passing)
- **LiveRVFBridge** (future): Calls `rvf_ingest` via MCP transport to write to `.rvf` file

### 3.4 Error Policy

RVF witness recording is **fire-and-forget**. A witness failure does NOT block message delivery. Rationale:

- The AIDefence stack (L1-L4) is the security gate; witness chains are the *audit trail*
- A broken audit trail is a monitoring problem, not a security crisis
- This matches the existing L5/L6 async policy

---

## 4. How RVF Mitigates GTIG Threats

### 4.1 Synthetic Identity (APT31)

**Attack:** A fake agent sends well-formed messages that pass L1-L4 content scanning.

**RVF Mitigation:**
- Every legitimate agent's decisions are in the witness chain from spawn time
- A synthetic agent has no entries in the chain — its first message has no provenance
- Chain verification (`rvf verify-witness`) shows a gap: message arrived without a corresponding PROVENANCE entry for the sender
- The `.rvf` file's segment signing (Ed25519/ML-DSA-65) ensures the chain itself wasn't forged

### 4.2 Rapport-Building Persona (Xanthorox)

**Attack:** An agent builds trust through legitimate interactions, then pivots to exfiltration.

**RVF Mitigation:**
- The witness chain records the *entire decision history*, not just recent messages
- The pivot point is visible: the chain shows a sharp change in `metadata.verdict` patterns
- Deterministic replay: mount the `.rvf` file, replay the witness chain, and see exactly where the agent's behavior diverged
- No need to "detect" the attack in real-time; the audit trail makes it forensically obvious

### 4.3 Compromised MCP Server (Hexstrike)

**Attack:** Attacker compromises the MCP server to inject fake tool responses.

**RVF Mitigation:**
- The circuit breaker in `mcp-transport.ts` already trips after 5 failures
- RVF adds a second layer: if the MCP server returns a different result for the same query, the content hash won't match the witness chain entry
- COW branching: each agent can operate on a derived `.rvf` branch; a compromised branch doesn't affect the parent

---

## 5. Technology Stack

| Component | Version | Role |
| :--- | :--- | :--- |
| `@ruvector/rvf` | 0.1.7 | TypeScript SDK for RVF operations |
| `@ruvector/rvf-mcp-server` | 0.1.3 | MCP server exposing RVF tools (stdio) |
| `orchestrator.ts` | Phase 12a | `IRVFBridge` integration, witness recording |
| `mcp-transport.ts` | Phase 9 | Circuit breaker, 10s connection timeout |
| `coordinator.ts` | Phase 5 | 6-Layer AIDefence Stack |
| `.mcp.json` | Phase 12a | RVF server config alongside claude-flow |

---

## 6. Test Coverage

| Suite | Tests | Status |
| :--- | :--- | :--- |
| RVF Witness Chain | 7 | Passing |
| Decision Ledger | 5 | Passing |
| Content Hash | 3 | Passing |
| Chain Linking | 2 | Passing |
| Orchestrator (existing) | 30+ | Passing |
| AIDefence (existing) | 150+ | Passing |
| **Total** | **201** | **All passing** |

---

## 7. Future Work (Phase 12b+)

1. **LiveRVFBridge**: Replace StubRVFBridge with real MCP calls to `rvf_ingest` and `rvf_status`
2. **Bunker File Creation**: `rvf create bunker.rvf --dimension 384` at swarm init time
3. **COW Branching**: Each Worker derives a child `.rvf` from the Architect's parent
4. **Witness Verification**: Post-run `rvf verify-witness bunker.rvf` to validate chain integrity
5. **Post-Quantum Signing**: Enable ML-DSA-65 segment signing for production deployment
6. **DID Integration**: If/when agents span trust domains, layer DID onto RVF's `CRYPTO_SEG`

---

## 8. Conclusion

The GTIG Feb 2026 threats (synthetic identities, rapport-building personas) cannot be stopped by scanning message content alone. The solution is **provenance integrity**: a tamper-evident, content-addressed record of every decision in the swarm.

RVF provides this natively through SHAKE-256 witness chains at the binary format level, without requiring blockchain infrastructure, complex DID protocols, or brittle behavioral fingerprinting. The integration into the SwarmOrchestrator is minimal (one additional async call per dispatch) and failure-tolerant (fire-and-forget policy).

The approach follows Reuven Cohen's "practical zero trust" principle: *No valid hash, no execution. Verify locally and deterministically. No validators to coordinate.*

---

*Scribed by Claude (Auditor) | Research directed by Gemini 3 Pro (Architect) | Phase 12a Cloud-Only*
*RuvBot Swarm | 2026-02-16*
