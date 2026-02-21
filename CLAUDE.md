# CLAUDE.md — RuvBot Turbo-Flow Project Intelligence

> Hand-authored ground truth. Do not overwrite with `generate-claude-md.sh`.
> Last updated: 2026-02-21 (Phase 14 complete, Phase 15 planned)

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
  main.ts                  # Entry point: firstFlight() + runGoal() GOAP pipeline
  pq-wrap.ts               # Post-quantum wrapper (ML-DSA-65 / FIPS 204)
  publish.ts               # Publishing utilities
  security/
    coordinator.ts         # AIDefence 6-layer gate orchestrator
    vector-scanner.ts      # HNSW attack-pattern scanner (ruvector)
    explorer.ts            # GOAP explorer agent
    adaptive-learner.ts    # Hebbian pattern learner
    live-mcp-client.ts     # Live MCP client
    mcp-transport.ts       # MCPTransportAdapter + CircuitBreaker
  swarm/
    orchestrator.ts        # Swarm orchestrator
    reviewer-logic.ts      # Reviewer swarm logic

docs/research/             # GOAP output documents (RVF-witnessed)
.claude-flow/data/         # HNSW database files (CURRENTLY EMPTY — see Known Bug below)
.agentic-qe/               # AQE v3 memory + config (SQLite)
```

---

## Phase History (Phases 1–14 Complete)

| Phase | Description |
|-------|-------------|
| 1–7   | Core security stack, HNSW seeding, GOAP pipeline, PAL integration |
| 8     | Model configuration corrected (gemini-2.5-flash primary) |
| 12a   | runGoal() with 3 MCP transports + AIDefence + RVF witness chain |
| 12b   | URL fetch phase (Node.js fetch, --fetch-urls CLI flag) |
| 13    | DID Passport design (pseudocode only — not built) |
| 14    | TSA attestation (DigiCert RFC 3161), Cosign/Rekor publish, ML-DSA-65 PQ re-wrap |

**Phase 15** (planned): Replace/augment AIDefence L3 with ruvector min-cut coherence gate
(arXiv:2512.13105 — El-Hayek, Henzinger, Li). Requires VectorDB bug fix first (see below).

---

## ⚠️ Known Bug: VectorDB Has Been In-Memory Since Phase 1

`src/security/vector-scanner.ts` initialises `VectorDB` with **wrong field names**:

```typescript
// BROKEN (current) — fields silently ignored, DB is in-memory only
new VectorDB({ path: '...', metric: 'cosine', dimensions: 384 })

// CORRECT — Phase 15 must use these exact names
new VectorDB({
  storagePath: '.claude-flow/data/ruvbot-coherence.db',
  distanceMetric: 'Cosine',   // capital C — lowercase throws enum error
  dimensions: 384,
  hnswConfig: { m: 32, efConstruction: 200, efSearch: 100, maxElements: 1_000_000 }
})
```

**Consequence**: `.claude-flow/data/` is empty. All 201 tests passed against an in-memory
database. No attack patterns were ever persisted. This must be fixed in Phase 15 before any
coherence-gate work begins.

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

## Phase 15 Pre-Work Checklist (Next Session)

- [ ] Write AISP spec for VectorDB init contract (`docs/specs/phase15-vectordb.aisp`)
- [ ] Fix `vector-scanner.ts`: `path` → `storagePath`, `metric:'cosine'` → `distanceMetric:'Cosine'`
- [ ] Create `src/phase15-seed.ts`: agentic-synth bootstrap (~630 synthetic patterns, 90/phase × 7)
- [ ] Examine `ruvector-mincut-wasm/src/lib.rs` for TypeScript API surface (λ metric)
- [ ] Implement λ fallback wrapper (hysteresis, handoff to Phase 14 L3 within 20ms budget)
- [ ] Delegate all verification to AQE swarm — use `qe-devils-advocate` + `qe-security-auditor`
