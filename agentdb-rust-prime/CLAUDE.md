# AgentDB Project Constitution (V3 Skills Edition)

## 1. Mandatory Skills
- **Architecture:** MUST use `os` (OpenSpec) skill.
- **Testing:** MUST use `aqe` (Agentic QE) skill.
- **Security:** MUST run `./scripts/drift-check.sh` before specific commits.

## 2. Platform Strategy (Manager-Routed)
- **Primary:** Cloud (Codespaces) -> Gemini 2.0 Flash.
- **Secondary:** Mac (Local) -> Ollama (via PAL Manager).

## 3. Mission Source
- Source of Truth: `./1-research.md`
## 4. Technical Commands
- **Build:** `npm run build`
- **Test (All):** `npx vitest run`
- **Test (Security):** `npx vitest run tests/security/`
- **Test (Integration):** `npx vitest run tests/integration/`
- **Run Swarm (Dev):** `npx tsx src/main.ts`
- **Lint:** `npm run lint`

## 5. RuvBot Swarm Context
- **Infrastructure:** Layered Neural Shield (L1-L6).
- **Security SLA:** <38ms weighted average latency.
- **Database:** SQLite + HNSW Vector Store in `.agentdb/`.
- **Orchestration:** Claude Flow V3 + Native Claude Code Teams.

## 6. Code Style & Patterns
- **Language:** TypeScript (ESM)
- **Design:** Domain-Driven Design (DDD) with a focus on Agentic Workflows.
- **Communication:** Every inter-agent handoff MUST be routed through the `SwarmOrchestrator` for Neural Shield scanning.

## 7. TDD & Research Strategy (Context-Aware)
- **Execution Logic (London School):** MANDATORY for all functional code and agent-to-agent logic. Use "Outside-In" TDD to drive design from `IMCPBridge` interfaces downward.
- **Strategic Immunity:** Research phases, PRD generation, and documentation (ADRs, Mission Logs) are EXEMPT from TDD. Do not write tests for non-executable artifacts.
- **Isolation & Verification:** For code, use Mocks/Spies for inter-agent MCP tools to verify interactions (e.g., correct embeddings sent to `SwarmOrchestrator`) without spawning the full swarm.
- **Goal:** Protect the 38ms SLA by ensuring functional logic is lean and verified, while allowing unrestricted velocity for research and strategy.