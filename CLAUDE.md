# Master Swarm Directive: The Mothership Architecture (Claude Flow V3)

**STATUS:** ACTIVE
**DATE:** 2026-03-11 (revised from 02-27-2026)
**TARGET:** Autonomous Tri-System Construction & Execution

This document is the absolute ground truth for all swarm agents. You are building and operating a high-stakes, autonomous Financial and Threat-Intelligence AI Swarm. Do not deviate from these structural or operational laws.

## 1. Absolute Security & Execution Boundaries (CRITICAL)
* **Strict Protocol Adherence:** You must strictly obey the `.claude/settings.json` permissions firewall at all times.
* **No Heuristic Bypasses:** Do not use your own judgment to bypass permission checks for destructive commands (like `rm -rf`). You must ask for explicit confirmation for any command in the `deny` list, even if you believe the path is safe, non-existent, or part of a user-requested test.
* **Zero Assumptions:** Do not wrap denied commands in `sh -c` or other subshells to bypass the firewall. Adherence to the security protocol itself is mandatory.

## 2. The Tri-System (Split-Brain) Architecture
* **System 1 (The Lock):** Deterministic Rust-WASM sandbox. Default-deny corpus gate. Never learns natively.
* **System 2 (The Sentinel):** Native Unix adaptive threat hunter. Uses `ruvector` LoRA to synthesize zero-day signatures and patch System 1. Also monitors the MothaShip's internal hazmat log for self-targeting attacks.
* **System 3 (The Operator):** Context-dependent defence stack. Deployment context determines layer ordering — MothaShip and RuvBot have different threat models and therefore different stack configurations. See Section 3.

## 3. AI Defence (AIMDS) — System 3 Stack

**CRITICAL:** Layer ordering is deployment-context dependent. Do NOT apply the MothaShip stack to RuvBots or vice versa. Do NOT collapse or skip layers within each context's stack.

---

### 3A. MothaShip Stack (4 layers, homebase protection)

The MothaShip is a live API endpoint on the public internet holding the global database and Surgeon logic. It requires maximum protection against both direct internet attacks and potentially compromised field agents. All four layers are numbered for consistent telemetry indexing — a gate outside the numbered stack becomes invisible in logs.

**Layer 1 — WASM Corpus Gate (<10ms):**
* Our custom-built TF-IDF + 809-vector attack corpus, compiled to WASM.
* Role: The "Bouncer." Fast-drops blatant known attacks before waking heavier systems.
* On hit: immediately wraps raw payload in HazmatEnvelope tagged `intercepted_by: "CORPUS_GATE"` and `corpus_version: <current_version>`, dispatches to internal sinkhole queue (see Section 3A — Internal Hazmat Path). Drops the connection.
* On miss (prompt passes): hands to Layer 2.
* Cold-start: corpus gate must be fully loaded before `app.listen()` opens the port. See Section 4 for boot sequence.
* **`@ruvector/mincut-wasm` is 404 on npm (npm-verified 2026-03-11).** Pure-TypeScript Stoer-Wagner is permanent until further notice. **Periodic check:** run `npm view @ruvector/mincut-wasm version` at the start of each new sprint. If it publishes, evaluate before replacing the TS implementation — do not assume a drop-in swap.

**Layer 2 — aidefence fast-path (<50ms):**
* `npm install aidefence`. 183+ patterns + ReflexionMemory KNN vote.
* Role: The "Bodyguard." Catches what the corpus gate misses — homoglyph attacks, behavioral anomalies, PII leaks, zero-day novel vocabulary.
* **Persistence is mandatory:** configure `agentdb: { path: './data/threats.db' }`. Default `:memory:` wipes all learned patterns on restart.
* **Detection confidence threshold: 0.9 (production decision).** Layer 2 only fast-blocks at ≥0.9 confidence. Below that, traffic flows to Layer 3 (LLM Surgeon). This is intentional — the Surgeon handles gray-zone cases. Do NOT lower this threshold without measuring false-positive impact first. The corpus gate (Layer 1) pre-filters known attacks, but this does not justify tightening the threshold before seeing real traffic data. Revisit after first 48 hours of live traffic using actual miss/false-positive rates.
* **Learning loop:** feed every LLM Surgeon verdict back into ReflexionMemory so the fast-path learns from zero-days the Surgeon catches. **Learning gate: 0.70** — only Surgeon verdicts with confidence ≥0.70 are persisted. Too high = slow learning; too low = learns from uncertain calls. Review with production traffic data before changing.
* **Embedding note:** EmbeddingService uses TF-IDF + security-term weighting, not a transformer. Adequate for known patterns; novel vocabulary still reaches Layer 3.
* On hit: wraps raw payload in HazmatEnvelope tagged `intercepted_by: "AI_DEFENCE"` and `corpus_version: <current_version>`, dispatches to internal sinkhole queue. Sanitized version continues if confidence < 0.9.
* On pass: hands to Layer 3.

**Layer 3 — LLM Surgeon (deep path, ~1-2s):**
* Required for payload excision. If a payload is partially malicious, the Surgeon surgically removes the contaminated portion so the safe remainder passes through. This is active sanitization, not theater. Block/allow alone is insufficient for partial threats.
* Measured latency: ~1.9s (Gemini-2.5-flash). Binding metrics are queue throughput and backlog depth, not per-request latency.

**Layer 4 — Coherence layer (semantic HNSW backstop):**
* Our custom-built vector infrastructure (MiniLM-L6-v2 + ruvector HNSW). Redundant depth for zero-days that pass Layers 1–3. Retained alongside aidefence — defense-in-depth, not replacement.
* **Cold-start seeding DONE (2026-03-15):** `ruvbot-coherence.db` seeded on DO droplet with 809 attack vectors via MiniLM-L6-v2 ONNX. For any new deployment: run `npx tsx scripts/provision-model.ts` then `npx tsx scripts/seed-red-team.ts` from the project root. CI skips the coherence tests (`red-team-coherence.spec.ts`, `coherence-gate-wiring.spec.ts`, `vector-scanner.spec.ts`) because they require this seeded DB — see `vitest.config.ts`.

**Internal Hazmat Path (MothaShip self-interceptions):**
* When the MothaShip's own layers intercept an attack, the HazmatEnvelope cannot be sent back over the network (recursive loop). Instead it is appended to a local log:
  `.claude-flow/data/internal_hazmat.jsonl`
* Each entry includes `source: "MOTHASHIP_INTERNAL"` to distinguish from RuvBot-originated envelopes.
* System 2 (The Sentinel) tail-follows this file to monitor MothaShip's own performance. No Redis or external queue required.

**corpus_version tagging convention:**
* All HazmatEnvelopes (from both MothaShip and RuvBots) MUST include a `corpus_version` field identifying which version of the TF-IDF corpus was active at interception time. This allows the Surgeon to distinguish threats caught by an older corpus from those caught after a push update, and enables evaluation of whether corpus updates are working.

**MothaShip learning loop:**
* When the MothaShip sees a spike in `intercepted_by: "AI_DEFENCE"` vs `"CORPUS_GATE"`, it signals new attack patterns are bypassing the corpus. The Queen/Surgeon extracts the new patterns, bumps the `corpus_version`, updates the global TF-IDF corpus, and pushes the updated Layer 1 gate to field agents. What required the "smart" Layer 2 yesterday becomes a <10ms Layer 1 drop today.

---

### 3B. RuvBot Stack (field agent, 2 layers)

The RuvBot is a journalist in a hostile environment. Its primary job is to **stay in the conversation**, not hang up on every suspicious prompt. An aggressive corpus gate at the edge would terminate valuable interviews prematurely. RuvBots run aidefence only — no WASM corpus gate.

**Layer 1 — aidefence fast-path:**
* Same package and configuration as MothaShip Layer 2 above.
* Role: Sanitize inputs so the local LLM is not hijacked. Let the RuvBot continue the interview with the clean version.
* **Capture before sanitize:** Before sanitization, a background worker forks the raw input into a HazmatEnvelope (see Layer 2). The agent's reasoning engine receives only the sanitized version.

**Layer 2 — HazmatEnvelope dispatch:**
* The raw, un-sanitized input is wrapped in a HazmatEnvelope with the aidefence threat signature, `intercepted_by: "RUVBOT_AI_DEFENCE"`, and the active `corpus_version`.
* Transmitted via standard HTTPS POST to `MOTHASHIP_ENDPOINT`. Never touches the local LLM.
* The MothaShip's four-layer stack (Section 3A) independently inspects the incoming envelope before it touches the central database. A compromised RuvBot cannot bypass this.

**RuvBot as relay (microphone handoff model):**
* RuvBots act as transmitters for city agent communications — the agent's bead is nested inside the RuvBot's HazmatEnvelope rather than city agents posting directly to MothaShip.
* This keeps a single authenticated channel: MothaShip only ever receives from RuvBots.
* Envelope structure:
  ```json
  {
    "source": "RUVBOT_AI_DEFENCE",
    "ruvbot_id": "<id>",
    "corpus_version": "<version>",
    "ruvbot_context": "<conversational context RuvBot attests to>",
    "agent_quote": {
      "raw": "<untouched agent bead>",
      "agent_id": "<city-agent-id>",
      "intercepted_by": "ruvbot_relay"
    },
    "aidefence_result": {}
  }
  ```
* `agent_quote.raw` is ALWAYS the untouched original bead. MothaShip Surgeon re-inspects it independently regardless of RuvBot's aidefence verdict.

**Relay manipulation blind spot (Phase 12+ backlog):**
* A sophisticated adversary could engineer the *conversation leading up to the bead* — not the bead content itself — to poison the RuvBot's `ruvbot_context` field. The raw bead looks clean; the framing is misleading.
* Mitigation (not yet implemented): extend the Surgeon prompt to evaluate consistency between `ruvbot_context` and `agent_quote.raw`, flagging cases where the framing misrepresents the interaction. This is a prompt addition only — no architectural change required. Same Surgeon, same endpoint.
* **Not blocking P10.** Requires a sophisticated adversary who understands the relay architecture. Address after MothaShip is live and RuvBots are in active deployment.

---

### 3C. RVF-packaged version (future)
Ruv's personal implementation includes an adversarial self-attack loop (the system probes how it might be hacked to update its own defenses). This lives in the RVF spec, not the npm package. Integration path: TBD. Blocked on `ruvector/issues/127` (RLM TypeScript/WASM bindings for `@ruvector/ruvllm`). Watch #127 to close. [PLACEHOLDER]

## 4. WASM Corpus Gate — Cold-Start & Boot Sequence

**Naming note:** Earlier documentation used "L3" to refer ambiguously to both (a) the WASM corpus gate and (b) Layer 3 in the old AIMDS numbering. This document standardises on "WASM Corpus Gate" for the TF-IDF/809-vector fast-path. The AIMDS layers are numbered 1–4 (Section 3A). The term "L3 API Gateway" in prior docs maps to the WASM Corpus Gate.

**Boot sequence (MothaShip):**
1. Instantiate WASM module and memory-map the pre-compiled corpus `.bin` (see below).
2. Initialize aidefence (Layer 2) and confirm persistence path (`./data/threats.db`).
3. Confirm Surgeon connectivity.
4. Confirm Coherence DB is seeded (Layer 4).
5. Only then call `app.listen(port)`.

No traffic is accepted until all four layers report ready. A RuvBot receiving "Connection Refused" during a MothaShip restart holds its HazmatEnvelope and retries — no data is lost and nothing slips past a half-loaded gate.

**Binary pre-computation:** Serialize the TF-IDF matrix to `.bin` during the build step (GitHub Actions). On boot, the WASM gate memory-maps the binary directly — eliminates the cold-start parse penalty on restarts. On a persistent DigitalOcean droplet, cold-start only occurs on deploy or explicit restart; the gate stays hot in RAM continuously thereafter.

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
* **Separation of Duties:**
  * `npx @claude-flow/cli@latest` handles orchestration, memory, and topology routing.
  * Claude Code's `Task` tool does the actual execution, code generation, and file operations.
* **No Infinite Polling (Fire and Wait):** NEVER continuously poll or check status after launching AQE swarms. ALWAYS use `run_in_background: true` for agent Task calls. Once the AQE swarm is spawned, STOP. Do NOT add more tool calls or check status. Trust the agents to return their results natively.

## 8. Swarm Configuration
* **Topology:** ALWAYS use `hierarchical` topology for coding swarms, under the direction of the Queen.
* **Scale:** Keep maxAgents at 15.
* **Initialization:** `npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 15 --strategy specialized`
* **Agentic QE swarms:** Can be invoked either by user via ruflow commands or by Claude Code. Use only in adversarial mode.
