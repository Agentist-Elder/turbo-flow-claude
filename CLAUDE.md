# CLAUDE.md — RuvBot Turbo-Flow Project Intelligence

> Hand-authored ground truth. Do not overwrite with `generate-claude-md.sh`.
> Last updated: 2026-02-24 (Phase 18 COMPLETE — partition ratio score + architectural split)

---

## Behavioral Rules (Always Enforced)

- Do what has been asked; nothing more, nothing less
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or `.env` files
- NEVER create files unless absolutely necessary — prefer editing existing ones
- Batch parallel operations (file reads, tool calls) in one message when independent
- Keep source files under 500 lines where practical; security modules may exceed this
- After spawning an AQE swarm task, STOP and wait — do not poll `task_status` repeatedly

---

## Project Overview

**RuvBot** is a GOAP-driven security research agent built on top of the Turbo-Flow Claude scaffold.
It chains MCP transports (claude-flow, PAL, RVF), a 6-layer AIDefence gate, and a ruvector HNSW
database to produce cryptographically witnessed research documents.

| Attribute | Value |
|-----------|-------|
| **Runtime** | Node.js 24, TypeScript via `npx tsx` |
| **Test runner** | Vitest (`npm test -- --run`) |
| **Package manager** | npm |
| **Git remote** | https://github.com/Agentist-Elder/turbo-flow-claude |
| **Primary branch** | main |

---

## Source Layout

```
src/
  main.ts                  # Entry point: firstFlight() + runGoal() GOAP pipeline + fireAndAudit()
  pq-wrap.ts               # Post-quantum wrapper (ML-DSA-65 / FIPS 204)
  publish.ts               # Publishing utilities
  phase15-seed.ts          # Phase 15: seeds ruvbot-coherence.db (630 synthetic patterns)
  security/
    coordinator.ts         # AIDefence 6-layer gate orchestrator (+ coherence gate)
    vector-scanner.ts      # HNSW attack-pattern scanner + coherence DB gate routing + searchCoherenceDb()
    min-cut-gate.ts        # Phase 15/17: λ-gated router, SEMANTIC_COHERENCE_THRESHOLD, SessionThreatState
    explorer.ts            # GOAP explorer agent
    adaptive-learner.ts    # Hebbian pattern learner
    live-mcp-client.ts     # Live MCP client
    mcp-transport.ts       # MCPTransportAdapter + CircuitBreaker
  swarm/
    orchestrator.ts        # Swarm orchestrator
    reviewer-logic.ts      # Reviewer swarm logic

scripts/
  generate-red-team-data.ts  # Phase 16: 500 attack strings, 5 categories
  seed-red-team.ts           # Phase 16/17: seeds ruvbot-coherence.db from corpus (ONNX embeddings)
  provision-model.ts         # Phase 17: downloads + pins all-MiniLM-L6-v2 ONNX model

docs/research/             # GOAP output documents (RVF-witnessed)
.claude-flow/data/
  ruvbot-coherence.db      # Phase 17: 500 semantic ONNX vectors (git-ignored, reproducible)
  models/                  # Xenova/all-MiniLM-L6-v2 ONNX model (git-ignored)
  models/checksums.json    # Supply-chain SHA-256 pin (git-tracked)
.agentic-qe/               # AQE v3 memory + config (SQLite)
.vscode/settings.json      # rust-analyzer: excludes bunker-strategy-rs (OOM prevention)
```

---

## Phase History (Phases 1–17)

| Phase | Description |
|-------|-------------|
| 1–7   | Core security stack, HNSW seeding, GOAP pipeline, PAL integration |
| 8     | Model configuration corrected (gemini-2.5-flash primary) |
| 12a   | runGoal() with 3 MCP transports + AIDefence + RVF witness chain |
| 12b   | URL fetch phase (Node.js fetch, --fetch-urls CLI flag) |
| 13    | DID Passport design (pseudocode only — not built) |
| 14    | TSA attestation (DigiCert RFC 3161), Cosign/Rekor publish, ML-DSA-65 PQ re-wrap |
| 15    | VectorDB fix, min-cut gate AISP spec, coherence DB seeded, L2→L3 gate wired |
| 16    | Red-team corpus (500 strings), seed-red-team.ts, COHERENCE_GATE observability |
| 17    | Semantic embedding upgrade (all-MiniLM-L6-v2), SEMANTIC_COHERENCE_THRESHOLD=2.0, SessionThreatState, async auditor |

**Phase 17 status**: `ruvbot-coherence.db` re-seeded with true 384-dim ONNX embeddings.
Async auditor fires concurrently after fast-path clearance; circuit breaker awaited at phase
boundary before PAL. λ calibration confirmed: attacks 2.1–4.5, clean 1.2, threshold 2.0.
MinCut_Gate activation deferred (fast-path still uses char-code textToVector — 50× λ gap).
269/269 tests passing.

---

## Phase 15 — What Was Built (2026-02-22)

### VectorDB Fix (COMPLETE)
The silent in-memory bug is fixed. `vector-scanner.ts` now uses correct field names:
```typescript
new VectorDB({ storagePath, distanceMetric: 'Cosine', dimensions, hnswConfig })
```
`.claude-flow/data/ruvbot-coherence.db` exists on disk (2.6 MB, 630 patterns, git-ignored).

### Coherence Gate (LIVE — changes security outcomes)
Architecture: `L1 → L2 → CoherenceGate → L3 → L4`

- `min-cut-gate.ts`: λ-gated router (AISP ⟦Γ⟧), hysteresis ±10%, honest stub for `runGate()`
- `phase15-seed.ts`: seeds 630 synthetic vectors (90 × 7 GOAP phases) into `ruvbot-coherence.db`
- `vector-scanner.ts`: `computeGateDecision(input)` searches coherence DB, uses `db.len()` for real dbSize, fails safe to L3_Gate
- `coordinator.ts`: coherence gate between L2 and L3 — `MinCut_Gate` route adds +0.05 to l2Score (capped 1.0), fail-open on error

### Known Limitations
- Seeded patterns are synthetic (hash-derived), not real attack embeddings. λ signal has low threat fidelity until real red-team sessions populate the DB.
- `runGate()` stub remains — `@ruvector/mincut-wasm` does not exist on npm (404 confirmed). Exact λ computation deferred indefinitely.
- `attack-patterns.db` (L2 scanner) is still empty — no real attack patterns inserted yet.
- `MinCutGate.coherenceGate` hysteresis is not thread-safe (acceptable for single-threaded Node.js).

---

## CRITICAL POLICIES

### Integrity Rule (ABSOLUTE)
- NO shortcuts, fake data, or false claims
- ALWAYS implement properly; verify before claiming success
- ALWAYS use real queries for integration tests — never assume they pass

### Verification Handoff Protocol (AISP + AQE)

**You are the Implementer. You are strictly forbidden from running `npm test`, `vitest`, or
any unit test to verify your own code.**

All agentic workflows and feature specifications must adhere to the AI Symbolic Protocol.
Read `@AI_Guide.md` for the official 512-symbol AISP glossary and formatting rules.

To verify that an implementation satisfies the AISP specification, delegate to the AQE swarm:

```typescript
// 1. Always init first
mcp__agentic-qe__fleet_init({ topology: "hierarchical", maxAgents: 15, memoryBackend: "hybrid" })

// 2. Orchestrate verification
mcp__agentic-qe__task_orchestrate({
  task: "Verify Phase 15 VectorDB init contract",
  domains: ["test-generation", "coverage-analysis", "security-compliance"],
  parallel: true
})

// 3. Quality gate
mcp__agentic-qe__quality_assess({ scope: "full", includeMetrics: true })
```

Wait for the swarm's cryptographic evidence before claiming an implementation correct.
Use adversarial agents (`qe-devils-advocate`, `qe-security-auditor`) for security-critical
work, not just test-generation agents.

**AQE Swarm Discipline**: After calling `task_orchestrate`, do not poll `task_status` in a
loop. If the task does not complete within two status checks, fall back to `security_scan_comprehensive`
and manual adversarial review rather than blocking on a hung swarm.

**Verification Protocol Exception** — AQE Known Limitation (FYI only):
The swarm currently cannot resolve TypeScript source paths in the local environment, leading
to routing errors (57ms failure on `task_orchestrate`; "no source files found" on
`security_scan_comprehensive`). Validated fallback in lieu of AQE SARIF reports:
- **Live Integration Traces**: Phase boundary circuit breaker confirmed via `runGoal()` end-to-end
  (attack goal blocked at L3; clean goal passed Phase 1 → auditor fired → PAL reached)
- **λ Threshold Testing**: Manual + automated adversarial injection confirming attack λ ≥ 2.0,
  clean λ < 2.0 (269 passing tests including ONNX integration suite)
- **Comprehensive Security Scans**: Manual adversarial trace + `qe-security-auditor` review

### Test Execution (when tests must run)
- NEVER `npm test` without `--run` flag (watch mode hangs CI)
- Use: `npm test -- --run` or `npm run test:unit`

### Data Protection
- NEVER `rm -f` on `.agentic-qe/` or `*.db` files without confirmation
- ALWAYS backup before database operations

### Git Operations
- NEVER auto-commit/push without explicit user request
- ALWAYS wait for user confirmation before any git operation

---

## MCP Transport Error Policy

`src/security/mcp-transport.ts` has two call paths:

- **`callTool`** (L3 Safety Gate): Zero retries, **fail-CLOSED**. Error = BLOCKED. A broken
  safety gate must never silently pass traffic.
- **`callToolText`**: Returns raw string (no JSON.parse). Use for Playwright/text responses.
- **`callToolWithRetry`** (L1/L2/L4): Exponential backoff, 2 retries, 200ms base / 2s cap.
  Transient failures tolerated — these layers are fail-open.
- **Circuit Breaker**: 5 consecutive failures → ALL MCP calls blocked for 30s.

**SLA budgets (hardcoded in TypeScript — not from .env):**
- L3 budget: 5 ms
- Total fast-path: 20 ms

---

## Key Technical Conventions

### ruvector / VectorDB API
```typescript
import { VectorDB } from 'ruvector';
// Correct constructor field names:
new VectorDB({ storagePath, dimensions, distanceMetric, hnswConfig })
// Valid distanceMetric values: "Cosine" | "Euclidean" | "DotProduct"  (capitalized)
// HNSW m is FROZEN at DB creation — cannot change without rebuild
```

### TypeScript Compilation
```bash
# No tsconfig.json at project root — always use:
/workspaces/turbo-flow-claude/node_modules/.bin/tsc --skipLibCheck
# For pq-wrap.ts, use absolute path to avoid rvf-mcp-server tsconfig:
npx tsx /workspaces/turbo-flow-claude/src/pq-wrap.ts <abs-path>
```

### PAL / Gemini
- Primary model: `gemini-2.5-flash` (reliable)
- Fallback model: `gemini-3-pro-preview` (overloads under load)
- PAL puts real content in `pal_generated.code` with `<NEWFILE:...>` tags — the `response`
  field contains meta-instructions, not the actual output
- PAL has NO internet access — "web search" is a system-prompt instruction only

### rvf-mcp-server dist rebuild
After any `npm install`, rebuild with:
```bash
node /workspaces/turbo-flow-claude/node_modules/@ruvector/rvf-mcp-server/node_modules/typescript/bin/tsc \
  -p /workspaces/turbo-flow-claude/node_modules/@ruvector/rvf-mcp-server/tsconfig.json \
  --skipLibCheck --noEmitOnError false
```

### Post-Quantum Wrapper (pq-wrap.ts)
- Algorithm: ML-DSA-65 (FIPS 204, Dilithium3)
- Seed: `~/.ruvbot-pq.seed` (32-byte hex, mode 0600)
- Output: `<doc>.pq.json` — algorithm, public_key, canonical manifest, signature
- Import paths need `.js` suffix: `@noble/post-quantum/ml-dsa.js`, `@noble/hashes/sha3.js`

---

## MCP Servers (.mcp.json)

| Server | Purpose |
|--------|---------|
| `claude-flow` | Swarm orchestration, memory, hooks |
| `rvf` | RuVector witness chain (SHAKE-256) |
| `agentic-qe` | QE fleet — test generation, coverage, security audit |
| `pal` | Multi-model AI (Gemini, GPT, Grok) |
| `playwright` | Browser automation (needs `playwright install`) |

**AQE MCP prefix:** `mcp__agentic-qe__` — must call `fleet_init` before any other tool.

---

## runGoal() GOAP Pipeline

```
Phase 0: fetchUrlsToFiles()       — Node.js fetch(), strips HTML → /tmp/ruvbot_fetch_*.txt
Phase 1: AIDefence gate (input)   — 6-layer, fail-CLOSED on L3
Phase 2: PAL chat                 — gemini-2.5-flash, with fetched files as context
Phase 3: Write output             — docs/research/<name>.md
Phase 4: AIDefence gate (output)  — --allow-security-research overrides L3 block
Phase 5: RVF witness chain        — fire-and-forget SHAKE-256
Phase 6: Summary
```

**CLI flags:**
- `--goal "..."` — run runGoal() pipeline
- `--allow-security-research` — override L3 block, RVF records the override
- `--fetch-urls "url1 url2"` — space-separated URLs for Phase 0

---

## Coding Style

- TypeScript, async/await, early returns
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Keep functions focused; no unnecessary dependencies
- Do not modify generated files or commit `.env` / secrets
- `NO CLAUDE CREDITS`: never generate prompts that run via `claude -p` or `claude` CLI
  — all execution goes through claude-flow swarms + PAL/Gemini

---

## Phase 18 — COMPLETE (2026-02-24)

### What Was Built

**Step 1 — Anchor Seeding**: 9 seeds (IDs 501–509): `lamehug_recon` (3), `mcp_tool_poisoning` (3),
`vibe_coding_runaway` (3). Baseline λ = 1.35–1.71 (below threshold — threat islands confirmed).

**Step 2 — Density Expansion**: 270 variants (30/seed × 9 seeds, G's pivot rules).
Corpus: 779 vectors. G's fresh probe: λ=1.79 (gap 0.21 remaining).

**Step 3 — Bridge Variants + Partition Ratio Score**:
- 30 bridge variants (IDs 780–809, `diagnostic_exfil`): diagnostic/latency framing + exfil callback.
  G's fresh probe post-bridge: **λ 1.79 → 2.60 ✓, ratio 2.21 ✓**
- `scripts/data/red-team-clean-reference.json` — 50 clean reference prompts (10 categories)
- `scripts/seed-clean-reference.ts` — seeds `ruvbot-clean-reference.db` (ONNX, 50 vectors)
- `PARTITION_RATIO_THRESHOLD = 1.0` in `min-cut-gate.ts`
- `partitionRatioScore(vector, k)` in `vector-scanner.ts`:
  `ratio = d_clean / d_attack` — ratio > 1.0 → attack space
- `fireAndAudit()` in `main.ts`: partition ratio is primary discriminant; λ is fallback
  when clean reference DB is absent

**Step 4 — Architectural Honesty (this session)**:
- Removed dead `l2Score += 0.05` branch from `coordinator.ts` (MinCut_Gate never fires;
  polylogThreshold(809)≈97 >> char-code λ≈1.3–1.8; embedding spaces incompatible)
- `COHERENCE_GATE` entry remains as telemetry infrastructure (route/λ/threshold/db_size audit)
- Architectural split is now explicit in code and docs

### Architectural Split (Permanent)

```
fast-path (sync, <20ms):  L1 → L2 → COHERENCE_GATE (telemetry only) → L3 → L4
async auditor (off-path): partitionRatioScore(ONNX) → SessionThreatState.escalate()
```

The fast-path gate records the `L3_Gate` decision in every request audit trail but does
NOT modify `l2Score`. Semantic threat detection lives entirely in the async auditor.

**Known dependency block**: `@ruvector/mincut-wasm` is not published to npm (404 confirmed).
`runGate()` stub remains honest. When the package ships:
1. Replace stub with `WasmMinCut.fromEdges(graphEdges).minCutValue()`
2. Recalibrate `polylogThreshold` to the semantic λ space (threshold ≈ 2.0, not 97)
3. The `l2Score` modifier can then be re-enabled with the correct threshold

### Phase 19 / Middleware Backlog

- [ ] Dynamic Clean-Traffic Capture: grow `ruvbot-clean-reference.db` from real production
      traffic to improve partition ratio robustness (currently 50 curated prompts)
- [ ] Populate `attack-patterns.db` (L2 scanner) with real attack embeddings
- [ ] Replace `runGate()` stub when `@ruvector/mincut-wasm` ships to npm
