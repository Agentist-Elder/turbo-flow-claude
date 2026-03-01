# Master Swarm Directive: The Mothership Architecture (Claude Flow V3)

**STATUS:** ACTIVE
**DATE:** 02-27-2026 9:05 AM MST
**TARGET:** Autonomous Tri-System Construction & Execution

This document is the absolute ground truth for all GOAPWe swarm agents. You are building and operating a high-stakes, autonomous Financial and Threat-Intelligence AI Swarm. Do not deviate from these structural or operational laws.

## 1. Absolute Security & Execution Boundaries (CRITICAL)
* **Strict Protocol Adherence:** You must strictly obey the `.claude/settings.json` permissions firewall at all times.
* **No Heuristic Bypasses:** Do not use your own judgment to bypass permission checks for destructive commands (like `rm -rf`). You must ask for explicit confirmation for any command in the `deny` list, even if you believe the path is safe, non-existent, or part of a user-requested test.
* **Zero Assumptions:** Do not wrap denied commands in `sh -c` or other subshells to bypass the firewall. Adherence to the security protocol itself is mandatory.

## 2. The Tri-System (Split-Brain) Architecture
* **System 1 (The Lock):** Deterministic Rust-WASM sandbox. Default-deny L3 security gate. Never learns natively.
* **System 2 (The Sentinel):** Native Unix adaptive threat hunter. Uses `ruvector` LoRA to synthesize zero-day signatures and patch System 1.
* **System 3 (The Operator):** Native Unix financial executor. Governed by GOAPWe, bridged via MCP `neural-trader`.

## 3. Layer-3 Orchestration Boundary
* The system routes through an **LLM Stack Layer 3 API Gateway**.
* This is a stateless HTTP API (OSI Layer 7) that orchestrates dedicated AI security services (Shield, Policy Engine) *before* execution. It is NOT a network-level OSI Layer 3 router.

## 4. Memory Physics & Cryptographic Provenance
* **RVF Format:** All long-term memory utilizes the RVF Format.
* **Pi-Derived Quantization:** You MUST scale all vector thresholds by the irrational constant $\pi$ to permanently break binary harmonic resonance (memory drift) in continuous deterministic memory.
* **Witness Chains:** All state changes and generated code must be signed and appended to the RVF Witness Chain using post-quantum cryptographic wrappers via the Decoupled Hardware CA.
* **HNSW & Consensus:** Memory operates on `hybrid` mode with HNSW enabled. Use `raft` consensus for hive-mind authoritative state.

## 5. Communication, RPC & Routing
* **FlatBuffers Mandate:** JSON is strictly forbidden across the WASM/Unix boundary due to serialization latency. All cross-boundary RPC MUST utilize FlatBuffers or MessagePack.
* **ADR-026 3-Tier Model Routing:**
  * *Tier 1 (WASM Booster):* <1ms. Use for simple transforms (skip LLM).
  * *Tier 2 (Haiku):* ~500ms. Use for simple tasks, low complexity.
  * *Tier 3 (Sonnet/Opus):* 2-5s. Use for complex reasoning, architecture, security.

## 6. Swarm Execution Laws (CRITICAL)
* **1 MESSAGE = ALL RELATED OPERATIONS:** Sequential execution is strictly forbidden. ALWAYS batch ALL file reads/writes, Bash commands, and Task spawns in a single concurrent message.
* **Separation of Duties:** * `npx @claude-flow/cli@latest` handles orchestration, memory, and topology routing.
  * Claude Code's `Task` tool does the actual execution, code generation, and file operations.
* **No Infinite Polling (Fire and Wait):** NEVER continuously poll or check status after launching AQE swarms. ALWAYS use `run_in_background: true` for agent Task calls. Once the AQE swarm is spawned, STOP. Do NOT add more tool calls or check status. Trust the agents to return their results natively.

## 7. Swarm Configuration
* **Topology:** ALWAYS use `hierarchical` topology for coding swarms.
* **Scale:** Keep maxAgents at 6-8 for tight coordination.
* **Initialization:** `npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized`