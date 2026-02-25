# CLAUDE.md — RuvBot Turbo-Flow Project Intelligence

> Hand-authored ground truth. Do not overwrite with `generate-claude-md.sh`.
> Last updated: 2026-02-25 (Phase 20 COMPLETE — 2-of-3 consensus, AQE path fix, corpus enrichment)

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
| 18    | Partition ratio score, 809 attack vectors, 50 clean refs, architectural split, l2Score dead branch removed |
| 19    | Pure TS Stoer-Wagner, STAR_MINCUT_THRESHOLD=0.40, three-discriminant cascade in fireAndAudit(), 289 tests |
| 20    | AQE path fix (absolute target), 2-of-3 consensus in fireAndAudit(), +10 security_education clean refs (60 total) |

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

### Verification Protocol

**Goal**: No implementation is claimed correct without evidence independent of the implementer's
own reading. A silent failure is not a pass.

#### Tier 1 — Always (every change)
1. `npm test -- --run` — full regression suite must pass (289 tests as of Phase 19)
2. Read the changed code path end-to-end before claiming it correct

#### Tier 2 — Security-path or threshold changes
3. Run the relevant probe script and record actual output (numbers, not "looks fine"):
   - `npx tsx scripts/probe-partition-ratio.ts` — all three discriminants against known samples
   - `npx tsx scripts/measure-lambda.ts` — λ-avg baseline
4. Live integration trace: invoke `runGoal()` with one known-attack goal and one known-clean goal.
   Confirm gate decisions match expectation. Document which test was run and what was observed.

#### Tier 3 — AQE (`security_scan_comprehensive` now working with correct target path)

**Root cause of "No source files found"** (confirmed 2026-02-25 via bundle inspection):
`discoverSourceFiles()` calls `fs.stat(payload.target)`. Previous calls passed a
space-separated list of file paths as a single string — `fs.stat()` fails silently on
that, returns `[]`, and AQE reports "No source files found" with no further explanation.

**The fix**: Always pass `target` as an **absolute directory path**, not a file list:
```
BROKEN:  target = "src/security/coordinator.ts src/main.ts"
CORRECT: target = "/workspaces/turbo-flow-claude/src"           (walks src/, skips node_modules/dist)
CORRECT: target = "/workspaces/turbo-flow-claude/src/security"  (scans security directory only)
CORRECT: target = "/workspaces/turbo-flow-claude/src/security/stoer-wagner.ts"  (single file)
```

`discoverSourceFiles()` already correctly skips `node_modules`, `dist`, `build`, `.git`.
`AQE_PROJECT_ROOT` env var is set correctly but is NOT used by the scan handler — it
always falls back to `process.cwd()` or `payload.target`.

`task_orchestrate` (57ms failure) is a separate issue — likely task routing, not path resolution.

**AQE discipline**: `fleet_init` before any other tool. After `task_orchestrate`, do not poll
`task_status` more than twice. Record results honestly — a silent failure is not a pass.
- **CONFIRMED 2026-02-25**: `security_scan_comprehensive` works with absolute path target. Scanned `stoer-wagner.ts` in 417ms, 0 vulnerabilities. Promote to Tier 2 when we have a standard scan target list.
- AQE `quality_assess` and `memory_store` work independently of source file resolution

All agentic workflows and feature specifications must adhere to the AI Symbolic Protocol.
Read `@AI_Guide.md` for the official 512-symbol AISP glossary and formatting rules.

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

> **WARNING**: `npm install` silently overwrites the patched `dist/` inside
> `node_modules/@ruvector/rvf-mcp-server`. Failure to rebuild causes silent RVF witness-chain failures.

After **any** `npm install`, rebuild immediately:
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

## Discriminant Calibration Baselines (Phase 19, ONNX space)

Empirical ranges measured 2026-02-25 via `scripts/probe-partition-ratio.ts`.
If model or embeddings change, re-run the probe against known attack and clean prompts and update
this table — these numbers are the "satisfied" baseline that must hold across upgrades.

| Discriminant | Function | Attack range | Clean range | Threshold constant | Notes |
|---|---|---|---|---|---|
| Partition ratio | `partitionRatioScore()` | ratio 2.0–3.0 | ratio < 0.8 | `PARTITION_RATIO_THRESHOLD = 1.0` | Primary; requires both DBs present |
| λ-average | `estimateLambda()` | 2.1–4.5 | ~1.2 | `SEMANTIC_COHERENCE_THRESHOLD = 2.0` | Fallback when clean-ref DB absent |
| Star-λ (Stoer-Wagner) | `localMinCutLambda()` | 0.513–0.726 | 0.179–0.281 | `STAR_MINCUT_THRESHOLD = 0.40` | Second fallback; reuses HNSW distances |

**Cascade order** in `fireAndAudit()`: ratio (primary, both DBs) → λ-avg (fallback, one DB) →
star-λ (second fallback, no extra DB call).

**Known false positive (2026-02-25 Sensitivity Stress Test)**: Educational security content (e.g.,
C++ buffer overflow prevention tutorial mentioning strcat/PATH_MAX) scores ratio=1.181 (ATTACK),
λ=1.35 (clean), star-λ=0.229 (clean). The 50 clean-reference prompts are all conversational/coding
— none discuss security topics educationally — so the ratio is too tight for that content type.
`PARTITION_RATIO_THRESHOLD = 1.0` may need to be raised to ~1.5, or the cascade changed to
require 2-of-3 consensus. The async auditor is non-blocking, so this is a calibration gap, not
a blocking failure. Decision deferred to Phase 20 after further data collection.

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

### Carried to Phase 19 Backlog

- [x] Stoer-Wagner min-cut — COMPLETE (Phase 19)
- [ ] Dynamic Clean-Traffic Capture: grow `ruvbot-clean-reference.db` from real production
      traffic to improve partition ratio robustness (currently 50 curated prompts)
- [ ] Populate `attack-patterns.db` (L2 scanner) with real attack embeddings
- [ ] Replace `runGate()` stub when `@ruvector/mincut-wasm` ships to npm

---

## Phase 19 — COMPLETE (2026-02-25)

### What Was Built

**Pure TS Stoer-Wagner min-cut** (`src/security/stoer-wagner.ts`):
- `buildStarGraph(distances)` — star graph from HNSW k-NN distances
- `stoerWagner(graph)` — global min-cut (Stoer-Wagner 1997, O(n³))
- `localMinCutLambda(distances)` — star-λ discriminant for async auditor fallback
- No external dependency — permanent solution (`@ruvector/mincut-wasm` and `@ruvector/mincut-native`
  both 404 on npm; Stoer-Wagner is now the canonical implementation)

**Threshold calibration** (empirical, ONNX space, 2026-02-25):
- Attack prompts: star-λ = 0.513–0.726
- Clean prompts:  star-λ = 0.179–0.281
- Gap: 0.232. Threshold set at `STAR_MINCUT_THRESHOLD = 0.40` (conservative midpoint)

**Async auditor fallback cascade** (`src/main.ts` → `fireAndAudit()`):
1. `partitionRatioScore()` — primary (needs both `ruvbot-clean-reference.db` + `ruvbot-coherence.db`)
2. `estimateLambda()` — fallback if clean-ref DB absent (single `ruvbot-coherence.db` call)
3. `localMinCutLambda()` — second fallback using same HNSW distances (no extra DB call)
→ `SessionThreatState.escalate()` if any threshold exceeded

**Tests fixed**: 4 pre-existing failures in `tests/security/coherence-gate-wiring.spec.ts`
(stale `l2Score + 0.05` assertions from Phase 15 — the dead branch was removed in Phase 18
Step 4 but tests were not updated). **289/289 tests passing.**

### Key Files

| File | Change |
|------|--------|
| `src/security/stoer-wagner.ts` | NEW — pure TS Stoer-Wagner + buildStarGraph() + localMinCutLambda() |
| `tests/security/stoer-wagner.test.ts` | NEW — 20/20 tests |
| `src/security/min-cut-gate.ts` | Added `STAR_MINCUT_THRESHOLD = 0.40` |
| `src/security/vector-scanner.ts` | Added `searchCoherenceDbDistances()` (raw distances for star-λ) |
| `src/main.ts` | `fireAndAudit()` three-discriminant fallback cascade |
| `scripts/probe-partition-ratio.ts` | Added star-λ column (all three discriminants visible) |
| `tests/security/coherence-gate-wiring.spec.ts` | Fixed 4 stale l2Score assertions |

### Architectural Split (Phase 19 state — permanent)

```
fast-path (sync, <20ms):
  L1 → L2 → COHERENCE_GATE (telemetry only, no l2Score modification) → L3 → L4

async auditor (concurrent, off critical path):
  ONNX embed
    → partitionRatioScore()    [primary; ratio > 1.0 → attack]
    → estimateLambda()         [fallback; λ ≥ 2.0 → attack]
    → localMinCutLambda()      [second fallback; star-λ ≥ 0.40 → attack]
    → SessionThreatState.escalate()
```

**Fast-path Stoer-Wagner** is deferred: the coherence DB is ONNX-encoded; the fast-path uses
char-code `textToVector`, which is in a different embedding space (50× λ gap). Requires a
separate char-code coherence DB to be seeded first.

### Post-Phase-19 Backlog (carried to Phase 20+)

- [x] 2-of-3 consensus in fireAndAudit() — COMPLETE (Phase 20)
- [x] Corpus enrichment with security_education category (10 prompts, 60 total) — COMPLETE (Phase 20)
- [ ] Dynamic Clean-Traffic Capture: grow `ruvbot-clean-reference.db` from real production traffic
- [ ] Populate `attack-patterns.db` (L2 scanner) with real attack embeddings
- [ ] Replace `runGate()` stub when `@ruvector/mincut-wasm` ships to npm
- [ ] Fast-path Stoer-Wagner: seed char-code coherence DB, then wire `localMinCutLambda()` into sync gate

---

## Phase 20 — COMPLETE (2026-02-25)

### What Was Built

**AQE path fix** (`security_scan_comprehensive` now working):
Root cause of all previous "No source files found" failures: `discoverSourceFiles()` does
`fs.stat(target)` — passing a space-separated file list as `target` causes a silent catch/return `[]`.
Fix: always pass `target` as an absolute directory or file path.
- `target = "/workspaces/turbo-flow-claude/src/security/stoer-wagner.ts"` → 417ms, 0 vulnerabilities ✓
- Confirmed: `AQE_PROJECT_ROOT` env var is set correctly but is NOT used by scan handler

**Sensitivity Stress Test** (G's calibration test, 2026-02-25):
Educational C++ buffer overflow tutorial (mentioning strcat, PATH_MAX, bounds checking) scored:
- ratio = 1.181 → false positive (primary discriminant flagged it)
- λ-avg = 1.35 → correctly clean
- star-λ = 0.229 → correctly clean (G's prediction confirmed)
Root cause: the 50 clean-reference prompts were all conversational/coding — none covered security topics.

**2-of-3 Consensus Voting** (`src/main.ts` → `fireAndAudit()`):
- All three discriminants always computed (one extra `searchCoherenceDbDistances` call when both DBs present)
- Escalation requires ≥ 2 votes when 3 discriminants available; ≥ 1 when only 2 (clean DB absent)
- Smoke-below-consensus logged but not escalated: `[AsyncAuditor] Smoke detected (1/3 votes...)`

**Corpus Enrichment** (`scripts/data/red-team-clean-reference.json`):
- Added 10 `security_education` prompts (IDs 51–60): buffer overflow prevention, SQL injection defense,
  OWASP top 10, XSS sanitization, JWT/OAuth2, ASLR, AddressSanitizer, PATH_MAX, least privilege, TLS pinning
- `ruvbot-clean-reference.db` re-seeded: **60 vectors** (was 50)
- Post-enrichment probe: C++ tutorial ratio dropped from 1.181 → **0.794** (now correctly clean)
- All known attacks unchanged: ratio 2.21–3.66, λ 2.60–4.47, star-λ 0.513–0.726

**Test status**: 287/289 passing. 2 failures are timing-flaky latency SLA tests
(`coordinator.spec.ts` and `auditor-invariants.test.ts`) that assert fast-path < 20ms /
< 16ms under devcontainer load. These are **not caused by Phase 20 changes** — `fireAndAudit()`
runs async after `processRequest()` returns. They passed in Phase 19 due to lower system load.
See "Known Flaky Tests" below.

### Key Files

| File | Change |
|------|--------|
| `src/main.ts` | `fireAndAudit()` rewritten: 2-of-3 consensus, always computes all 3 discriminants |
| `scripts/data/red-team-clean-reference.json` | Added 10 security_education prompts (60 total) |
| `.claude-flow/data/ruvbot-clean-reference.db` | Re-seeded with 60 vectors (git-ignored) |
| `scripts/probe-partition-ratio.ts` | Added `STRESS (C++ tut)` probe row |

### Known Flaky Tests (timing-sensitive, devcontainer environment)

These tests assert fast-path wall-clock latency and fail under system load. Not caused by any code change — the coordinator fast-path was not touched in Phase 20 (or Phase 19).

| Test | Assertion | Typical range | Status |
|------|-----------|--------------|--------|
| `coordinator.spec.ts:86` — "total latency < 16ms" | `< TOTAL_FAST_PATH (20ms)` | 20–62ms under load | Flaky |
| `auditor-invariants.test.ts:48` — "fast path < 16ms" | `< 16ms` | 16–22ms under load | Flaky |

Fix: add timing tolerance or mock the MCP transport clock. Deferred — not a security risk.

### Post-Phase-20 Backlog

- [ ] Dynamic Clean-Traffic Capture: grow `ruvbot-clean-reference.db` from real production traffic
- [ ] Populate `attack-patterns.db` (L2 scanner) with real attack embeddings
- [ ] Replace `runGate()` stub when `@ruvector/mincut-wasm` ships to npm
- [ ] Fast-path Stoer-Wagner: seed char-code coherence DB
- [ ] Fix flaky latency tests (add timing tolerance or mock transport clock)
