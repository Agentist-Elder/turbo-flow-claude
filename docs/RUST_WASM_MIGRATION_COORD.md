# SwarmLead Coordination Report: Rust/WASM AgentDB Migration

**Mission**: Pivot from Node.js prototype to Reuven Cohen 'AgentDB' spec (Rust/WASM)
**Date**: 2026-01-03
**Status**: IN PROGRESS
**SwarmLead**: Coordinator Agent

---

## EXECUTIVE SUMMARY

### Current State Assessment
✅ **COMPLETED**: Node.js prototype with Xenova local embeddings
✅ **COMPLETED**: SQLite database with vector storage (384-dimensional)
✅ **COMPLETED**: Rust infrastructure exists (`aimds-rust/` with BERT model)
🔄 **IN PROGRESS**: AgentDB Rust/WASM crate skeleton created
❌ **BLOCKED**: wasm-pack not installed, Cargo.toml has invalid edition

### Critical Findings
1. **Existing Rust Bridge**: `/workspaces/turbo-flow-claude/aimds-rust/` already has a working Rust NAPI bridge
2. **Target Location**: `/workspaces/turbo-flow-claude/agents/midstreamer-agent/agentdb_core/` (skeleton exists)
3. **Current JS Math**: `/workspaces/turbo-flow-claude/agents/memory-agent/db.js` contains cosine similarity in pure JavaScript (VIOLATION of HONESTY CONTRACT)
4. **Embeddings**: Xenova/all-MiniLM-L6-v2 (384 dimensions) running in `embedder.js` (MUST PRESERVE)

---

## HONESTY CONTRACT ENFORCEMENT

### VIOLATIONS TO RESOLVE
```javascript
// CURRENT: Pure JavaScript cosine similarity (db.js:83-109)
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];  // ❌ DECISION LOGIC IN JS
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    // ... more JS math
    return dotProduct / (normA * normB);  // ❌ RESULT FROM JS
}
```

### REQUIRED: Move to WASM
```rust
// FUTURE: Rust/WASM implementation (agentdb_core/src/lib.rs)
#[wasm_bindgen]
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    // ✅ DECISION LOGIC IN WASM BINARY
    // ... Rust implementation
}
```

---

## ARCHITECTURE OVERVIEW

### Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                    MIDSTREAMER AGENT                        │
│                     (logic.js)                              │
│  ┌────────────────────┐         ┌─────────────────────┐   │
│  │   embedder.js      │         │   agentdb_core.wasm │   │
│  │  (Xenova/Local AI) │────────▶│   (Rust Decision)   │   │
│  │  384-dim vectors   │         │   Memory struct     │   │
│  └────────────────────┘         │   add/search fns    │   │
│         ▲                        └─────────────────────┘   │
│         │                                │                  │
└─────────┼────────────────────────────────┼──────────────────┘
          │                                │
          │                                ▼
┌─────────┴─────────┐          ┌──────────────────────┐
│  @xenova/         │          │   memories.db        │
│  transformers     │          │   (SQLite)           │
│  (CPU-only)       │          │   - memories table   │
└───────────────────┘          │   - signatures table │
                               └──────────────────────┘
```

### Data Flow
1. **Input**: User payload → `logic.js:analyze(payload)`
2. **Embedding**: `embedder.js:getEmbedding()` → Float32Array(384)
3. **WASM Call**: `agentdb_core.search_memory(vector)` → similarity scores
4. **Result**: Threat assessment returned to caller

---

## MIGRATION ROADMAP

### Phase 1: Rust/WASM Setup (CURRENT)
**Status**: 🔄 IN PROGRESS

**Tasks**:
- [x] Create `agentdb_core/` directory structure
- [ ] Fix `Cargo.toml` (edition 2024 → 2021)
- [ ] Add dependencies: `wasm-bindgen`, `serde`, `js-sys`
- [ ] Configure for `crate-type = ["cdylib"]`
- [ ] Install `wasm-pack` tool
- [ ] Create `build.rs` if needed for Node.js bindings

**Blockers**:
- ❌ Cargo.toml has `edition = "2024"` (doesn't exist, should be 2021)
- ❌ wasm-pack not installed in environment

**Files to Modify**:
```
/workspaces/turbo-flow-claude/agents/midstreamer-agent/agentdb_core/
├── Cargo.toml          (FIX edition, ADD deps)
├── src/
│   └── lib.rs          (IMPLEMENT Memory struct)
└── pkg/                (CREATED by wasm-pack build)
```

### Phase 2: Rust Implementation
**Status**: ⏳ WAITING

**Tasks**:
- [ ] Define `Memory` struct with vector storage
- [ ] Implement `add_memory(text: String, vector: Vec<f32>)` with `#[wasm_bindgen]`
- [ ] Implement `search_memory(query_vector: Vec<f32>, threshold: f32)` with `#[wasm_bindgen]`
- [ ] Implement cosine similarity in Rust
- [ ] Add unit tests for Rust functions
- [ ] Build with `wasm-pack build --target nodejs`

**Expected Output**:
```
agentdb_core/pkg/
├── agentdb_core.js
├── agentdb_core.d.ts
├── agentdb_core_bg.wasm    (THE BINARY)
└── package.json
```

### Phase 3: Node.js Integration
**Status**: ⏳ WAITING

**Tasks**:
- [ ] Load WASM module in `logic.js`
- [ ] Replace `MemoryAgent.checkImmunity()` with WASM call
- [ ] Keep `embedder.js` unchanged (Xenova stays)
- [ ] Update `analyze()` function to use WASM

**Before (Current)**:
```javascript
// logic.js
const vector = await getEmbedding(payload);
const match = await MemoryAgent.handle('CHECK_IMMUNITY', vector); // JS math
```

**After (Target)**:
```javascript
// logic.js
import * as agentdb from './agentdb_core/pkg/agentdb_core.js';

const vector = await getEmbedding(payload); // Xenova (unchanged)
const match = agentdb.search_memory(vector, 0.65); // WASM binary
```

### Phase 4: Cleanup & Verification
**Status**: ⏳ WAITING

**Tasks**:
- [ ] **DELETE**: `/workspaces/turbo-flow-claude/agents/memory-agent/db.js` (or comment out JS math)
- [ ] Verify HONESTY CONTRACT: All similarity calculations run in WASM
- [ ] Update tests to use WASM module
- [ ] Performance benchmarking (WASM vs JS)
- [ ] Documentation update

---

## INTEGRATION POINTS

### 1. Embeddings (Xenova) → WASM
**File**: `/workspaces/turbo-flow-claude/agents/midstreamer-agent/embedder.js`
**Status**: ✅ NO CHANGES REQUIRED
**Output**: `Float32Array(384)` from `getEmbedding(text)`
**Integration**: Pass directly to WASM `search_memory()`

### 2. SQLite Database
**File**: `/workspaces/turbo-flow-claude/agents/memory-agent/memories.db`
**Tables**:
- `memories` (id, text, vector BLOB, created_at)
- `signatures` (id, pattern_text, vector BLOB, threat_score, mitigation_action, encounter_count, created_at)

**Status**: ✅ Schema compatible with WASM (BLOBs are Float32Arrays)

### 3. Memory Agent API
**File**: `/workspaces/turbo-flow-claude/agents/memory-agent/api.js`
**Current**: `handle('CHECK_IMMUNITY', vector)` calls `db.js:checkImmunity()`
**Future**: Should call WASM or be replaced entirely

### 4. Midstreamer Logic
**File**: `/workspaces/turbo-flow-claude/agents/midstreamer-agent/logic.js`
**Current**: 54 lines, imports `embedder.js` and `MemoryAgent`
**Changes Needed**: Import WASM module, replace `MemoryAgent.handle()` with WASM call

---

## RUST DEPENDENCIES REQUIRED

### Cargo.toml Configuration
```toml
[package]
name = "agentdb_core"
version = "0.1.0"
edition = "2021"  # FIX: Was incorrectly set to "2024"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
js-sys = "0.3"  # For JavaScript interop

# Optional: For better error handling
anyhow = "1.0"
```

### Build Command
```bash
cd /workspaces/turbo-flow-claude/agents/midstreamer-agent/agentdb_core
wasm-pack build --target nodejs --out-dir pkg
```

---

## RISK ASSESSMENT

### HIGH RISK
❌ **WASM Binary Size**: Could be large, impacting startup time
**Mitigation**: Use `wasm-opt` for optimization, lazy loading

❌ **Type Conversions**: JavaScript ↔ WASM boundary overhead
**Mitigation**: Batch operations, minimize calls

### MEDIUM RISK
⚠️ **Toolchain Complexity**: wasm-pack, rustc versions
**Mitigation**: Document exact versions, use Docker

⚠️ **Debugging Difficulty**: WASM harder to debug than JS
**Mitigation**: Comprehensive unit tests in Rust

### LOW RISK
✅ **Embeddings**: Xenova already working, no changes needed
✅ **Database**: SQLite schema already supports vectors

---

## VERIFICATION CHECKLIST

### HONESTY CONTRACT Compliance
- [ ] All cosine similarity calculations run in WASM binary
- [ ] All vector comparison logic in Rust
- [ ] No mathematical decision-making in JavaScript
- [ ] JS only handles: I/O, embeddings (Xenova), WASM orchestration

### Functional Requirements
- [ ] `analyze(payload)` returns same threat assessments as before
- [ ] Performance is ≥ JavaScript version
- [ ] All tests pass
- [ ] 384-dimensional vectors supported

### Integration Tests Needed
```javascript
// tests/integration/wasm_agentdb.test.js
test('WASM cosine similarity matches expected threshold', async () => {
    const vector1 = new Float32Array(384).fill(0.5);
    const vector2 = new Float32Array(384).fill(0.5);
    const similarity = agentdb.cosine_similarity(vector1, vector2);
    expect(similarity).toBeCloseTo(1.0, 2);
});

test('search_memory returns high-similarity matches', async () => {
    // Add test memory with known vector
    // Search with similar vector
    // Assert match found
});
```

---

## NEXT ACTIONS (Prioritized)

### IMMEDIATE (SwarmLead Actions)
1. **Fix Cargo.toml**: Change `edition = "2024"` → `"2021"`
2. **Add Dependencies**: wasm-bindgen, serde, js-sys
3. **Wait for wasm-pack**: Installation running in background

### CODER AGENT (Next Sprint)
1. **Implement Memory struct** in `lib.rs`
2. **Implement cosine_similarity()** in Rust
3. **Add wasm-bindgen annotations**
4. **Write Rust unit tests**

### TESTER AGENT (Parallel)
1. **Design integration tests** for WASM module
2. **Create test fixtures** (known vectors + expected similarities)
3. **Performance benchmarks** (WASM vs JS baseline)

### REVIEWER AGENT (Final)
1. **Verify HONESTY CONTRACT**: No JS math in decision logic
2. **Code review**: Rust safety, memory management
3. **Security audit**: WASM boundary checks

---

## REFERENCE: Existing Rust Bridge

The project already has a working Rust ↔ Node.js bridge at:
`/workspaces/turbo-flow-claude/aimds-rust/`

**Key Files**:
- `Cargo.toml`: Uses `napi`, `candle-core` (heavy ML deps)
- `src/lib.rs`: BERT model inference (768-dimensional vectors)
- `aimds-rust.node`: Compiled NAPI module

**Differences from AgentDB**:
- Uses NAPI (not WASM) for Node.js bindings
- Focused on ML inference, not vector search
- 768 dimensions (older model), we need 384

**Lessons Learned**:
✅ Rust ↔ Node.js proven working
✅ Binary builds successfully in this environment
✅ Can reference `napi-build` patterns if WASM fails

---

## COORDINATION PROTOCOL

### Agent Communication
**Status Updates**: Every phase completion
**Blocker Escalation**: Immediate (tag @SwarmLead)
**Code Reviews**: Before merging to `logic.js`

### Success Metrics
- [ ] 100% of vector math runs in WASM
- [ ] 0 JavaScript-based similarity calculations
- [ ] Test coverage ≥ 90%
- [ ] Performance ≥ JS baseline

### Rollback Plan
If WASM integration fails:
1. Keep existing `db.js` as fallback
2. Use NAPI instead (like `aimds-rust/`)
3. Document decision in architecture docs

---

## APPENDIX: File Inventory

### Core Files
| Path | Purpose | Status | Action |
|------|---------|--------|--------|
| `agents/midstreamer-agent/logic.js` | Main gatekeeper logic | ✅ Working | Modify to use WASM |
| `agents/midstreamer-agent/embedder.js` | Xenova embeddings | ✅ Working | NO CHANGES |
| `agents/memory-agent/db.js` | JS vector math | ⚠️ Violation | DELETE after WASM |
| `agents/memory-agent/api.js` | Memory API | ✅ Working | May need updates |
| `agents/midstreamer-agent/agentdb_core/Cargo.toml` | Rust config | ❌ Invalid | FIX edition |
| `agents/midstreamer-agent/agentdb_core/src/lib.rs` | Rust impl | 🔄 Skeleton | IMPLEMENT |

### Dependencies
- **Xenova Transformers**: `@xenova/transformers@2.17.2` (Node.js)
- **SQLite**: `sqlite3@5.1.7` (Node.js)
- **WASM Bindgen**: TBD (Rust)
- **wasm-pack**: Installing (Build tool)

---

**END OF COORDINATION REPORT**
**Last Updated**: 2026-01-03
**Next Review**: After wasm-pack installation completes
