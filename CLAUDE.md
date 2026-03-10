# Master Swarm Directive: The Mothership Architecture (Claude Flow V3)

**STATUS:** ACTIVE
**DATE:** 02-27-2026 9:05 AM MST
**TARGET:** Autonomous Tri-System Construction & Execution

This document is the absolute ground truth for all swarm agents. You are building and operating a high-stakes, autonomous Financial and Threat-Intelligence AI Swarm. Do not deviate from these structural or operational laws.

## 1. Absolute Security & Execution Boundaries (CRITICAL)
* **Strict Protocol Adherence:** You must strictly obey the `.claude/settings.json` permissions firewall at all times.
* **No Heuristic Bypasses:** Do not use your own judgment to bypass permission checks for destructive commands (like `rm -rf`). You must ask for explicit confirmation for any command in the `deny` list, even if you believe the path is safe, non-existent, or part of a user-requested test.
* **Zero Assumptions:** Do not wrap denied commands in `sh -c` or other subshells to bypass the firewall. Adherence to the security protocol itself is mandatory.

## 2. The Tri-System (Split-Brain) Architecture
* **System 1 (The Lock):** Deterministic Rust-WASM sandbox. Default-deny L3 security gate. Never learns natively.
* **System 2 (The Sentinel):** Native Unix adaptive threat hunter. Uses `ruvector` LoRA to synthesize zero-day signatures and patch System 1.
* **System 3 (The Operator):** AI Defence fast-path gate + LLM Surgeon for sanitization + Coherence layer backstop. Three-layer stack (see Section 3).

## 3. AI Defence (AIMDS) — System 3 Stack
All inbound traffic passes through three layers in order. Do NOT collapse or skip layers.
* **Layer 1 — aidefence fast-path (<12ms):** `npm install aidefence`. 183+ patterns + ReflexionMemory KNN vote. Handles ~95% of known attacks locally.
  * **Persistence is mandatory:** configure `agentdb: { path: './data/threats.db' }`. Default `:memory:` wipes all learned patterns on restart.
  * **Detection confidence threshold: 0.9 (production decision).** Layer 1 only fast-blocks at ≥0.9 confidence. Below that, traffic flows to Layer 2 (LLM Surgeon). This is intentional — the Surgeon handles gray-zone cases. Do NOT lower this threshold without measuring false-positive impact first.
  * **Learning loop:** feed every LLM Surgeon verdict back into ReflexionMemory so the fast-path learns from zero-days the Surgeon catches. **Learning gate: 0.70** — only Surgeon verdicts with confidence ≥0.70 are persisted. This is a tuning opportunity: too high = slow learning; too low = learns from uncertain calls. Review with production traffic data before changing.
  * **Embedding note:** EmbeddingService uses TF-IDF + security-term weighting, not a transformer. Adequate for known patterns; novel vocabulary still reaches Layer 2.
* **Layer 2 — LLM Surgeon (deep path, ~1-2s):** Required for payload excision. If a payload is partially malicious, the Surgeon surgically removes the contaminated portion so the safe remainder passes through. This is active sanitization, not theater. Block/allow alone is insufficient for partial threats.
* **Layer 3 — Coherence layer (semantic HNSW backstop):** Our custom-built vector infrastructure. Redundant depth for zero-days that pass Layers 1 and 2. Retained alongside aidefence — defense-in-depth, not replacement.
* **RVF-packaged version (future):** Ruv's personal implementation includes an adversarial self-attack loop (the system probes how it might be hacked to update its own defenses). This lives in the RVF spec, not the npm package. Integration path: TBD pending spec review. [PLACEHOLDER]

## 4. Layer-3 Orchestration Boundary
* The system routes through an **LLM Stack Layer 3 API Gateway**.
* This is a stateless HTTP API (OSI Layer 7) that orchestrates dedicated AI security services (Shield, Policy Engine) *before* execution. It is NOT a network-level OSI Layer 3 router.

## 5. Memory Physics & Cryptographic Provenance
* **RVF Format:** All long-term memory utilizes the RVF Format.
* **Pi-Derived Quantization:** You MUST scale all vector thresholds by the irrational constant $\pi$ to permanently break binary harmonic resonance (memory drift) in continuous deterministic memory.
* **Witness Chains:** All state changes and generated code must be signed and appended to the RVF Witness Chain using post-quantum cryptographic wrappers via the Decoupled Hardware CA.
* **HNSW & Consensus:** Memory operates on `hybrid` mode with HNSW enabled. Use `raft` consensus for hive-mind authoritative state.

## 6. Communication, RPC & Routing
* **FlatBuffers Mandate:** JSON is strictly forbidden across the WASM/Unix boundary due to serialization latency. All cross-boundary RPC MUST utilize FlatBuffers or MessagePack.
* **ADR-026 3-Tier Model Routing:**
  * *Tier 1 (WASM Booster):* <1ms. Use for simple transforms (skip LLM).
  * *Tier 2 (Haiku):* ~500ms. Use for simple tasks, low complexity.
  * *Tier 3 (Sonnet/Opus):* 2-5s. Use for complex reasoning, architecture, security.

## 7. Swarm Execution Laws (CRITICAL)
* **GOAP pre-Thinker gate (src/main.ts:959):** The AIDefence gate before the GOAP planner is hardcoded at `orchestrator.dispatch(goalMessage)` with no skip flag. Adding one requires punching a deliberate hole in the security layer. Workaround for internal security research: use `mcp__pal__secaudit` from CC directly (bypasses the GOAP pre-gate entirely). Do NOT add `--skip-goal-gate` without an explicit decision to accept that risk.
* **1 MESSAGE = ALL RELATED OPERATIONS:** Sequential execution is strictly forbidden. ALWAYS batch ALL file reads/writes, Bash commands, and Task spawns in a single concurrent message.
* **Separation of Duties:** * `npx @claude-flow/cli@latest` handles orchestration, memory, and topology routing.
  * Claude Code's `Task` tool does the actual execution, code generation, and file operations.
* **No Infinite Polling (Fire and Wait):** NEVER continuously poll or check status after launching AQE swarms. ALWAYS use `run_in_background: true` for agent Task calls. Once the AQE swarm is spawned, STOP. Do NOT add more tool calls or check status. Trust the agents to return their results natively.

## 8. Swarm Configuration
* **Topology:** ALWAYS use `hierarchical` topology for coding swarms, under the direction of the Queen.
* **Scale:** Keep maxAgents at 15.
* **Initialization:** `npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 15 --strategy specialized`
* **Agentic QE swarms:** Can be invoked either by user via ruflow commands or by Claude Code. Use only in adversarial mode
