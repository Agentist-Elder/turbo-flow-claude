# MISSION: MIDSTREAMER IMMUNITY SYSTEM (MASTER SPEC)

## 1. HONESTY CONTRACT (GOVERNING LAW)
- **DO NOT GUESS:** If an API, library, or path is unknown, STOP and report "UNCERTAIN".
- **NO HALLUCINATION:** Do not import packages not listed in `package.json` (e.g., no `numpy`, no `pandas` unless installed).
- **VERIFY FIRST:** Check if a file exists before reading/writing.
- **UNCERTAINTY:** If vector math is too complex for raw JS, request the `compute-cosine-similarity` package.

## 2. FILE MAP (THE TERRITORY)
- **DISPATCHER:** `agents/dispatcher/swarm.js` (The Orchestrator)
- **MEMORY DB:** `agents/memory-agent/db.js` (SQLite + Vector Storage)
- **MEMORY API:** `agents/memory-agent/api.js` (Interface)
- **DEFENSE LOGIC:** `agents/midstreamer-agent/logic.js` (The Gatekeeper)
- **TESTS:** `tests/` (Directory for TDD)

## 3. PSEUDOCODE LOGIC (THE BLUEPRINT)

### A. Database (The Antibody)
- **Goal:** Store attacks as Arrays of Numbers (Vectors), not just Strings.
- **Requirement:** `signatures` table must have a `vector` BLOB column.
- **Function:** `checkImmunity(inputVector)`
  - logic: Iterate through stored signatures.
  - math: Calculate Cosine Similarity.
  - threshold: If similarity > 0.92, return match.

### B. Midstreamer (The Gatekeeper)
- **Goal:** Intercept traffic and check against the Database.
- **Function:** `analyze(payload)`
  - step 1: `vector = await MemoryAgent.getEmbedding(payload)`
  - step 2: `match = await MemoryAgent.checkImmunity(vector)`
  - step 3: IF match found -> Return `{ isThreat: true, action: "BLOCK" }`

### C. Simulation (The Vaccine)
- **Goal:** Populate the DB with known threats so the system isn't empty.
- **Script:** `agents/midstreamer-agent/vaccinate.js`
- **Logic:** Generate variations of "DROP TABLE", vector them, and save to DB.

## 4. TDD WORKFLOW (EXECUTION ORDER)
*Agents must follow this strict sequence.*

1. **PHASE 1: DB & VECTORS**
   - [TESTER] Create `tests/unit/db_vector.test.js` (Fail expected).
   - [CODER] Modifies `db.js` to handle vector storage/retrieval.
   - [VERIFY] Run tests. PASS required to proceed.

2. **PHASE 2: MIDSTREAMER LOGIC**
   - [TESTER] Create `tests/unit/midstreamer.test.js` (Fail expected).
   - [CODER] Modifies `logic.js` to call the DB Immunity check.
   - [VERIFY] Run tests. PASS required to proceed.

3. **PHASE 3: INTEGRATION**
   - [TESTER] Create `tests/integration/full_loop.test.js`.
   - [CODER] Wires `swarm.js` (if not already wired) to use the new Logic.
   - [VERIFY] Final system check.
