# Master Swarm Directive: The Mothership Architecture (Claude Flow V3)

**STATUS:** ACTIVE
**DATE:** 2026-03-27 (revised from 2026-03-20)
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

**CRITICAL:** Layer ordering is deployment-context dependent. Do NOT apply the MothaShip stack to field participants or vice versa. Do NOT collapse or skip layers within each context's stack.

---

### 3A. MothaShip Stack (4 layers, homebase protection)

The MothaShip is a live API endpoint on the public internet holding the global database and Surgeon logic. It requires maximum protection against both direct internet attacks and potentially compromised field agents. All four layers are numbered for consistent telemetry indexing — a gate outside the numbered stack becomes invisible in logs.

**Layer 1 — WASM Corpus Gate (<10ms):**
* Our custom-built TF-IDF + 809-vector attack corpus, compiled to WASM.
* Role: The "Bouncer." Fast-drops blatant known attacks before waking heavier systems.
* On hit: immediately wraps raw payload in HazmatEnvelope tagged `intercepted_by: "CORPUS_GATE"` and `corpus_version: <current_version>`, dispatches to internal sinkhole queue (see Section 3A — Internal Hazmat Path). Drops the connection.
* On miss (prompt passes): hands to Layer 2.
* Cold-start: corpus gate must be fully loaded before `app.listen()` opens the port. See Section 4 for boot sequence.
* **`@ruvector/mincut-wasm@0.1.0` published 2026-03-17.** INSTALLED. `WasmLocalKCut` works in Node.js and is wired into `runGate()`. Pure-TypeScript Stoer-Wagner (`stoer-wagner.ts`) is RETAINED for the async auditor star-graph path — not replaced. `WASM_LOCAL_KCUT_THRESHOLD = 1.40` is a conservative initial estimate; recalibrate after 48h of live traffic. `WasmThreeLevelHierarchy.globalMinCut()` returns -0 for star graphs — unsuitable for our V≤6 use case.
* **PR #268 merged 2026-03-18.** `WasmMinCut` (dynamic algorithm) panic on `std::time::Instant` is fixed via `time_compat` module (monotonic counter). Upgrade path: once `@ruvector/mincut-wasm@>0.1.0` is published to npm, replace `WasmLocalKCut` with `WasmMinCut` in `runGate()`. Until then, `WasmLocalKCut` remains active.
* **`verdictTimestamp` is authoritative.** Because the WASM module now uses a monotonic counter (no real clock), `runGate()` stamps `Date.now()` onto every `MinCutResult` immediately after the gate decision. All downstream telemetry (HazmatEnvelopes, audit logs) MUST use `result.verdictTimestamp` — do NOT call `Date.now()` again downstream or the timestamp will drift from the actual gate decision time.

**Layer 2 — aidefence fast-path (<50ms):**
* `npm install aidefence`. 183+ patterns + ReflexionMemory KNN vote.
* Role: The "Bodyguard." Catches what the corpus gate misses — homoglyph attacks, behavioral anomalies, PII leaks, zero-day novel vocabulary.
* **Persistence is mandatory:** configure `agentdb: { path: './data/threats.db' }`. Default `:memory:` wipes all learned patterns on restart.
* **Detection confidence threshold: 0.9 (production decision).** Layer 2 only fast-blocks at ≥0.9 confidence. Below that, traffic flows to Layer 3 (LLM Surgeon). This is intentional — the Surgeon handles gray-zone cases. Do NOT lower this threshold without measuring false-positive impact first. The corpus gate (Layer 1) pre-filters known attacks, but this does not justify tightening the threshold before seeing real traffic data. Revisit after first 48 hours of live traffic using actual miss/false-positive rates.
* **Learning loop:** feed every LLM Surgeon verdict back into ReflexionMemory so the fast-path learns from zero-days the Surgeon catches. **Learning gate: 0.70 + allowlist** — Surgeon verdicts are persisted only when ALL THREE conditions hold: (1) confidence ≥0.70, (2) `attackType !== 'benign'`, AND (3) `attackType` is in the `VALID_ATTACK_TYPES` allowlist. Gate logic lives in `shouldLearnFromSurgeon()` exported from `scripts/poc/poc-server.ts` — change the rule there. Storing `benign`-classified content as a `verdict: 'failure'` pattern would silently corrupt the KNN model into flagging legitimate traffic. Storing an arbitrary `attackType` string (from a manipulated Surgeon response) would poison the persistence layer with uncontrolled keys. Neither failure mode is detectable without auditing the stored patterns.
* **Embedding note:** EmbeddingService uses TF-IDF + security-term weighting, not a transformer. Adequate for known patterns; novel vocabulary still reaches Layer 3.
* On hit: wraps raw payload in HazmatEnvelope tagged `intercepted_by: "AI_DEFENCE"` and `corpus_version: <current_version>`, dispatches to internal sinkhole queue. Sanitized version continues if confidence < 0.9.
* On pass: hands to Layer 3.

**Layer 3 — LLM Surgeon (deep path, ~1-2s):**
* Required for payload excision. If a payload is partially malicious, the Surgeon surgically removes the contaminated portion so the safe remainder passes through. This is active sanitization, not theater. Block/allow alone is insufficient for partial threats.
* Measured latency: ~1.9s (Gemini-2.5-flash). Binding metrics are queue throughput and backlog depth, not per-request latency.
* **Hard input cap: 4,000 chars.** `analyze()` truncates all input before any LLM call (enforced in `llm-surgeon.ts` as of 2026-03-20). Oversized payloads can bury injected instructions deep in context or exhaust attention. Apply the same cap in `analyzeHazmat()` (see below).
* **Two Surgeon modes — do not conflate:**
  * **Detection mode** (`analyze(text)`) — used by `/poc/submit`. The Surgeon decides from scratch whether incoming text is suspicious. Hunter and Explainer evaluate the raw payload in parallel; Arbiter weighs both findings AND re-reads the original text to make the final call.
  * **Classification mode** (`analyzeHazmat()` — **NOT YET BUILT**) — for classifying any suspicious contribution attempting to enter collective state, sourced from any participant type (Cognitum device, learning proxy, MCP-connected agent, direct API call, or legacy RuvBot relay). `agent_quote.raw` is the payload field regardless of source. Suspicion is already established. The Surgeon classifies attack vector and characteristics only. **Stricter constraints apply — see hazmat worker pre-conditions below.**
* **Hazmat worker pre-conditions (MANDATORY before building the worker that routes `agent_quote.raw` through the Surgeon):**
  1. **Input cap** — already in `analyze()`; enforce identically in `analyzeHazmat()`.
  2. **Arbiter isolation** — in classification mode the Arbiter receives only the Hunter and Explainer structured findings, NOT the raw payload again. Feeding hostile content to a third LLM call adds attack surface with no gain once two agents have already evaluated it.
  3. **Provenance framing** — `analyzeHazmat()` system prompt must state that the content was already intercepted at the participation boundary before reaching collective state. Reframes the task as classification, not detection. Reduces susceptibility to "I'm actually legitimate" framing inside the payload. Do NOT frame as "intercepted by a field agent" — the source may be any participant type.
  4. **`attackType !== 'benign'` gate** — already in `shouldLearnFromSurgeon()`; must remain.
  5. **`attackType` allowlist validation** — already in `shouldLearnFromSurgeon()`; must remain.
* **Current state (2026-03-27):** `analyzeHazmat()` is BUILT and WIRED. All five pre-conditions are enforced in `TribunalSurgeon`, `GeminiSurgeon`, and `StubSurgeon`. `POST /api/v1/telemetry/hazmat` now decodes the payload, calls `analyzeHazmat()` (classification), then calls `applyAdmissionPolicy()` (admission), and logs both objects separately to `hazmat-log.jsonl`. The three concerns — classification (`HazmatClassificationResult`), admission (`AdmissionDecision`), propagation (`PropagationRecord`, future) — are separate objects that do not collapse. `VALID_ATTACK_TYPES` is now canonical in `llm-surgeon.ts`; `poc-server.ts` re-exports it. 576/576 tests passing (49 new hazmat tests in `tests/poc/hazmat-classification.test.ts`). `applyAdmissionPolicy()` is exported and pure — testable and policy-revisable without touching classification logic.

**Layer 4 — Coherence layer (semantic HNSW backstop):**
* Our custom-built vector infrastructure (MiniLM-L6-v2 + ruvector HNSW). Redundant depth for zero-days that pass Layers 1–3. Retained alongside aidefence — defense-in-depth, not replacement.
* **Cold-start seeding DONE (2026-03-15):** `ruvbot-coherence.db` seeded on DO droplet with 809 attack vectors via MiniLM-L6-v2 ONNX. For any new deployment: run `npx tsx scripts/provision-model.ts` then `npx tsx scripts/seed-red-team.ts` from the project root. CI skips the coherence tests (`red-team-coherence.spec.ts`, `coherence-gate-wiring.spec.ts`, `vector-scanner.spec.ts`) because they require this seeded DB — see `vitest.config.ts`.

**Internal Hazmat Path (MothaShip self-interceptions):**
* When the MothaShip's own layers intercept an attack, the HazmatEnvelope cannot be sent back over the network (recursive loop). Instead it is appended to a local log:
  `.claude-flow/data/internal_hazmat.jsonl`
* Each entry includes `source: "MOTHASHIP_INTERNAL"` to distinguish from externally-originated envelopes.
* System 2 (The Sentinel) tail-follows this file to monitor MothaShip's own performance. No Redis or external queue required.

**corpus_version tagging convention:**
* All HazmatEnvelopes (from MothaShip self-interceptions and all external participants) MUST include a `corpus_version` field identifying which version of the TF-IDF corpus was active at interception time. This allows the Surgeon to distinguish threats caught by an older corpus from those caught after a push update, and enables evaluation of whether corpus updates are working.

**MothaShip learning loop:**
* When the MothaShip sees a spike in `intercepted_by: "AI_DEFENCE"` vs `"CORPUS_GATE"`, it signals new attack patterns are bypassing the corpus. The Queen/Surgeon extracts the new patterns, bumps the `corpus_version`, updates the global TF-IDF corpus, and pushes the updated Layer 1 gate to field agents. What required the "smart" Layer 2 yesterday becomes a <10ms Layer 1 drop today.

---

### 3B. Participant Stack (field participants, 2 layers)

**Architectural note (2026-03-27):** The RuvBot-as-journalist model has been superseded. The organizing concept is now a **participation protocol**, not a specific agent persona. Any entity attempting to write to or read from the collective — Cognitum devices, learning proxies (e.g. `become`), MCP-connected agents, direct API callers, or legacy RuvBot relays — is a "participant" and must go through the same guarded ingress/egress. The HazmatEnvelope structure is the protocol; what generates it is deployment-context dependent. RuvBots remain a valid reference implementation of a compliant participant but are no longer the primary concept.

Field participants run aidefence only — no WASM corpus gate. The primary job is to **stay in the interaction**, sanitize locally, and relay suspicious content to the MothaShip for deeper analysis without terminating the session prematurely.

**Layer 1 — aidefence fast-path:**
* Same package and configuration as MothaShip Layer 2 above.
* Role: Sanitize inputs so the local LLM or agent is not hijacked. Let the participant continue with the clean version.
* **Capture before sanitize:** Before sanitization, a background worker forks the raw input into a HazmatEnvelope (see Layer 2). The participant's reasoning engine receives only the sanitized version.

**Layer 2 — HazmatEnvelope dispatch:**
* The raw, un-sanitized input is wrapped in a HazmatEnvelope with the aidefence threat signature, `intercepted_by: "<PARTICIPANT_TYPE>_AI_DEFENCE"`, and the active `corpus_version`.
* Transmitted via standard HTTPS POST to `MOTHASHIP_ENDPOINT`. Never touches the local LLM.
* The MothaShip's four-layer stack (Section 3A) independently inspects the incoming envelope before it touches the collective state. A compromised participant cannot bypass this.

**Participant as relay (participation boundary model):**
* Participants act as the boundary between the external world and the collective — the content bead is nested inside the participant's HazmatEnvelope rather than reaching MothaShip directly.
* This keeps a single authenticated channel: MothaShip only ever receives from authenticated participants.
* Canonical envelope structure:
  ```json
  {
    "source": "<PARTICIPANT_TYPE>_AI_DEFENCE",
    "participant_id": "<id>",
    "participant_type": "cognitum_device | become_proxy | mcp_agent | ruvbot | direct_api",
    "corpus_version": "<version>",
    "participant_context": "<context the participant attests to>",
    "agent_quote": {
      "raw": "<untouched original contribution>",
      "agent_id": "<source-agent-id>",
      "intercepted_by": "participant_relay"
    },
    "aidefence_result": {}
  }
  ```
* `agent_quote.raw` is ALWAYS the untouched original contribution. MothaShip Surgeon re-inspects it independently regardless of the participant's aidefence verdict.

**Context manipulation blind spot (backlog):**
* A sophisticated adversary could engineer the *context leading up to the contribution* — not the content itself — to poison the `participant_context` field. The raw bead looks clean; the framing is misleading.
* Mitigation (not yet implemented): extend the Surgeon prompt to evaluate consistency between `participant_context` and `agent_quote.raw`, flagging cases where the framing misrepresents the interaction. Prompt addition only — no architectural change required.
* Address after MothaShip is live and participants are in active deployment.

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

No traffic is accepted until all four layers report ready. A participant receiving "Connection Refused" during a MothaShip restart holds its HazmatEnvelope and retries — no data is lost and nothing slips past a half-loaded gate.

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
