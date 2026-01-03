# AgentDB Rust/WASM Implementation Requirements Document

**Version:** 1.0
**Date:** 2026-01-03
**Author:** Requirements Analyst
**Target:** Rust Architect & Development Team

---

## Executive Summary

This document specifies the requirements for refactoring the current JavaScript-based memory database system (`agents/memory-agent/db.js`) into a high-performance Rust library with WebAssembly (WASM) bindings for Node.js integration. The system implements a vector-based memory storage and similarity search engine for AI agents, supporting both general memories and immunity signatures for threat detection.

---

## 1. Current System Analysis

### 1.1 Existing Implementation (`agents/memory-agent/db.js`)

**Technology Stack:**
- SQLite3 database (via `sqlite3` npm package)
- Float32Array for vector storage
- Buffer-based binary serialization
- Node.js CommonJS/ESM modules

**Key Features:**
- Two-table schema: `memories` and `signatures`
- Vector embedding storage (384 dimensions)
- Cosine similarity search algorithm
- Time-aware memory retrieval with timestamps
- Immunity system for threat pattern recognition
- Configurable similarity thresholds (0.65 for immunity checks)

**Current Performance Characteristics:**
- Vector dimension: 384 (Xenova/all-MiniLM-L6-v2 model)
- Cosine similarity: JavaScript implementation
- Database: SQLite file-based storage
- Memory serialization: Buffer-based Float32Array conversion

### 1.2 Integration Points

**Embedding Generation:**
- Current: Rust-based vector engine (`aimds-rust`) via NAPI-RS
- Model: `nreimers/MiniLM-L6-H384-uncased` (BERT-based)
- Output: 384-dimensional Float64Array (converted to Float32Array for storage)
- Integration file: `agents/memory-agent/index.js` (line 54, 71)

**Consumers:**
- Memory Agent (`agents/memory-agent/index.js`)
- Memory API (`agents/memory-agent/api.js`)
- Midstreamer Agent (`agents/midstreamer-agent/`)
- Test suites (`tests/unit/db_vector.test.js`, `tests/integration/full_loop.test.js`)

### 1.3 Preserved Functionality Requirements

**MUST PRESERVE:**
1. **Database Schema Compatibility:**
   - Table structure for `memories` and `signatures`
   - Column names and types
   - Auto-increment primary keys
   - Timestamp-based creation tracking
   - BLOB storage for vectors

2. **Vector Operations:**
   - Cosine similarity calculation (dot product / norms)
   - 384-dimensional vector support
   - Float32Array compatibility
   - Normalized vector handling

3. **API Surface:**
   - `addMemory(text, vector)` → Promise<number>
   - `getAllMemories()` → Promise<Array<Memory>>
   - `addSignature(pattern, vector, score, action)` → Promise<number>
   - `checkImmunity(inputVector)` → Promise<Signature|null>
   - `cosineSimilarity(a, b)` → number
   - `getSignatureById(id)` → Promise<Signature>

4. **Behavioral Guarantees:**
   - Similarity threshold: 0.65 for immunity checks (configurable)
   - Best-match selection (highest similarity)
   - Encounter count tracking with upsert logic
   - Dimension validation (must be 384)
   - Zero-division safety in cosine calculation

---

## 2. Memory Struct Schema

### 2.1 Core Memory Structure

```rust
/// Represents a stored memory with vector embedding and metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    /// Unique identifier (auto-increment from database)
    pub id: i64,

    /// Original text content of the memory
    pub text: String,

    /// 384-dimensional embedding vector (normalized)
    /// Must match Xenova/all-MiniLM-L6-v2 output dimensions
    pub vector: Vec<f32>,

    /// UTC timestamp of creation (ISO 8601 format)
    /// Example: "2026-01-03T21:06:45.123Z"
    pub created_at: String,
}
```

**Field Constraints:**
- `id`: Non-negative integer, unique per table
- `text`: Non-empty string, max length determined by SQLite TEXT limit
- `vector`: Exactly 384 elements, each f32 in range [-1.0, 1.0]
- `created_at`: Valid ISO 8601 datetime string with millisecond precision

### 2.2 Immunity Signature Structure

```rust
/// Represents a threat pattern signature for immunity system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Signature {
    /// Unique identifier
    pub id: i64,

    /// Text pattern that identifies the threat
    /// Example: "DROP TABLE users" or "<script>malicious</script>"
    pub pattern_text: String,

    /// 384-dimensional embedding vector for similarity matching
    pub vector: Vec<f32>,

    /// Threat severity score (0.0 to 1.0, where 1.0 = confirmed attack)
    pub threat_score: f32,

    /// Mitigation action to take when matched
    /// Valid values: "BLOCK", "SANITIZE", "LOG", "WARN"
    pub mitigation_action: String,

    /// Number of times this pattern has been encountered
    pub encounter_count: i64,

    /// UTC timestamp of first creation
    pub created_at: String,
}
```

**Field Constraints:**
- `threat_score`: Range [0.0, 1.0], f32 precision
- `mitigation_action`: Enum-like string, validated against known actions
- `encounter_count`: Non-negative integer, increments on duplicate inserts
- `pattern_text`: UNIQUE constraint in database

### 2.3 Search Result Structure

```rust
/// Result of a similarity search operation
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// The matched memory or signature
    pub item: Memory, // or Signature

    /// Cosine similarity score (0.0 to 1.0)
    pub similarity: f32,

    /// Distance metric (optional, computed as 1.0 - similarity)
    pub distance: f32,
}
```

---

## 3. Function Specifications

### 3.1 Add Memory Function

**Signature:**
```rust
/// Add a new memory to the database
///
/// # Arguments
/// * `text` - The text content of the memory
/// * `vector` - The 384-dimensional embedding vector
///
/// # Returns
/// * `Result<i64, Error>` - The ID of the inserted memory or error
///
/// # Errors
/// * `DimensionMismatch` - If vector is not 384 dimensions
/// * `DatabaseError` - If SQL operation fails
pub fn add_memory(text: &str, vector: &[f32]) -> Result<i64, Error>
```

**Behavior:**
1. Validate vector dimension = 384
2. Serialize vector to BLOB (little-endian f32 bytes)
3. Execute SQL: `INSERT INTO memories (text, vector) VALUES (?, ?)`
4. Return `lastID` from SQLite
5. Current timestamp auto-generated by SQLite `DEFAULT CURRENT_TIMESTAMP`

**Error Handling:**
- Invalid dimensions: Return `DimensionMismatch` error
- Database locked: Retry with exponential backoff (3 attempts)
- Null/empty text: Accept but warn (some use cases may need it)

### 3.2 Add Signature Function

**Signature:**
```rust
/// Add or update a threat signature with upsert logic
///
/// # Arguments
/// * `pattern` - The threat pattern text
/// * `vector` - The 384-dimensional embedding vector
/// * `score` - Threat score (0.0 to 1.0)
/// * `action` - Mitigation action ("BLOCK", "SANITIZE", etc.)
///
/// # Returns
/// * `Result<i64, Error>` - The ID of the inserted/updated signature
pub fn add_signature(
    pattern: &str,
    vector: &[f32],
    score: f32,
    action: &str,
) -> Result<i64, Error>
```

**Behavior:**
1. Validate vector dimension = 384
2. Validate score ∈ [0.0, 1.0]
3. Validate action against allowed values
4. Execute SQL with UPSERT:
   ```sql
   INSERT INTO signatures (pattern_text, vector, threat_score, mitigation_action)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(pattern_text) DO UPDATE SET
       vector = excluded.vector,
       encounter_count = encounter_count + 1
   ```
5. Return ID of inserted/updated row

**UPSERT Logic:**
- If `pattern_text` exists: Update vector, increment `encounter_count`
- If new: Insert with `encounter_count = 1`
- Preserve original `created_at` on update

### 3.3 Get All Memories Function

**Signature:**
```rust
/// Retrieve all memories from the database
///
/// # Returns
/// * `Result<Vec<Memory>, Error>` - Vector of all memories
pub fn get_all_memories() -> Result<Vec<Memory>, Error>
```

**Behavior:**
1. Execute SQL: `SELECT * FROM memories`
2. For each row:
   - Deserialize BLOB to Vec<f32>
   - Construct Memory struct
3. Return vector of Memory objects
4. Empty database returns empty Vec (not error)

### 3.4 Get Signature By ID Function

**Signature:**
```rust
/// Retrieve a specific signature by ID
///
/// # Arguments
/// * `id` - The signature ID to retrieve
///
/// # Returns
/// * `Result<Option<Signature>, Error>` - The signature if found
pub fn get_signature_by_id(id: i64) -> Result<Option<Signature>, Error>
```

**Behavior:**
1. Execute SQL: `SELECT * FROM signatures WHERE id = ?`
2. If found: Deserialize and return Some(Signature)
3. If not found: Return Ok(None)
4. Database error: Return Err(DatabaseError)

---

## 4. Cosine Similarity Algorithm

### 4.1 Mathematical Specification

**Formula:**
```
cosine_similarity(a, b) = dot(a, b) / (norm(a) * norm(b))

Where:
- dot(a, b) = Σ(a[i] * b[i]) for i = 0 to n-1
- norm(a) = sqrt(Σ(a[i]²)) for i = 0 to n-1
```

**Function Signature:**
```rust
/// Calculate cosine similarity between two vectors
///
/// # Arguments
/// * `a` - First vector (must be 384 dimensions)
/// * `b` - Second vector (must be 384 dimensions)
///
/// # Returns
/// * `Result<f32, Error>` - Similarity score in range [0.0, 1.0]
///
/// # Errors
/// * `DimensionMismatch` - If vectors have different lengths
/// * `InvalidDimension` - If vectors are not 384 dimensions
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> Result<f32, Error>
```

### 4.2 Implementation Requirements

**Algorithm Steps:**
1. **Dimension Validation:**
   ```rust
   if a.len() != b.len() {
       return Err(Error::DimensionMismatch {
           expected: a.len(),
           actual: b.len(),
       });
   }
   if a.len() != 384 {
       warn!("Vector dimension {} does not match expected 384", a.len());
   }
   ```

2. **Parallel Computation (Single Pass):**
   ```rust
   let mut dot_product = 0.0_f32;
   let mut norm_a = 0.0_f32;
   let mut norm_b = 0.0_f32;

   for i in 0..a.len() {
       dot_product += a[i] * b[i];
       norm_a += a[i] * a[i];
       norm_b += b[i] * b[i];
   }

   norm_a = norm_a.sqrt();
   norm_b = norm_b.sqrt();
   ```

3. **Zero-Division Safety:**
   ```rust
   if norm_a == 0.0 || norm_b == 0.0 {
       return Ok(0.0);
   }
   ```

4. **Final Calculation:**
   ```rust
   let similarity = dot_product / (norm_a * norm_b);
   Ok(similarity)
   ```

### 4.3 Performance Optimizations

**MUST Implement:**
- SIMD vectorization for dot product and norm calculations
- Compiler optimization flags: `-C target-cpu=native`
- Inline functions for hot path
- Pre-allocation of result vectors

**SHOULD Implement:**
- Batch processing API for multiple similarity calculations
- Caching of vector norms if vectors are reused
- Parallel processing for multi-vector searches

**Example Optimized Code:**
```rust
#[inline(always)]
pub fn cosine_similarity_simd(a: &[f32], b: &[f32]) -> f32 {
    // Use packed_simd or std::simd for AVX2/NEON instructions
    // Target: 4-8x speedup over scalar implementation
}
```

---

## 5. Check Immunity Function (Search)

### 5.1 Function Signature

```rust
/// Check if an input vector matches any known threat signatures
///
/// # Arguments
/// * `input_vector` - The 384-dimensional embedding to check
///
/// # Returns
/// * `Result<Option<Signature>, Error>` - Best matching signature if similarity > threshold
///
/// # Behavior
/// - Searches all signatures in database
/// - Computes cosine similarity for each
/// - Returns signature with highest similarity if > 0.65
/// - Returns None if no matches above threshold
pub fn check_immunity(input_vector: &[f32]) -> Result<Option<Signature>, Error>
```

### 5.2 Algorithm Specification

**Step-by-Step Process:**

1. **Retrieve All Signatures:**
   ```rust
   let signatures = execute_sql("SELECT * FROM signatures")?;
   if signatures.is_empty() {
       return Ok(None);
   }
   ```

2. **Similarity Computation:**
   ```rust
   let mut best_match: Option<(Signature, f32)> = None;
   let mut highest_similarity = 0.0_f32;

   for signature in signatures {
       let stored_vector = deserialize_vector(&signature.vector_blob)?;
       let similarity = cosine_similarity(input_vector, &stored_vector)?;

       if similarity > 0.65 && similarity > highest_similarity {
           highest_similarity = similarity;
           best_match = Some((signature.clone(), similarity));
       }
   }
   ```

3. **Return Best Match:**
   ```rust
   Ok(best_match.map(|(sig, _)| sig))
   ```

### 5.3 Performance Considerations

**Current Bottleneck:**
- JavaScript implementation: O(n * d) where n = signatures, d = 384 dimensions
- No indexing for vector similarity (inherent to cosine similarity)

**Rust Optimizations:**
1. **SIMD Vectorization:** 4-8x speedup on similarity calculations
2. **Parallel Search:** Use `rayon` for multi-threaded signature scanning
3. **Early Termination:** If similarity = 1.0 (perfect match), stop search
4. **Approximate Search (Future):** Consider HNSW or FAISS for large signature sets

**Threshold Configuration:**
```rust
pub struct ImmunityConfig {
    /// Minimum similarity to trigger immunity (default: 0.65)
    pub threshold: f32,

    /// Enable parallel search for >100 signatures
    pub enable_parallel: bool,

    /// Maximum signatures to check (safety limit)
    pub max_signatures: usize,
}
```

---

## 6. WASM-Bindgen Interface Requirements

### 6.1 Node.js Integration via NAPI-RS

**Build System:**
- Use `napi-rs` (already in use for `aimds-rust`)
- Target: `cdylib` crate type
- Platform support: Linux x64, macOS (x64 + ARM64), Windows x64

**Package Structure:**
```
agentdb-rust/
├── Cargo.toml           # Rust crate definition
├── package.json         # npm package metadata
├── index.js             # JavaScript entry point (generated)
├── index.d.ts           # TypeScript definitions (generated)
├── src/
│   └── lib.rs           # NAPI-RS bindings
└── agentdb-rust.node    # Compiled native module
```

### 6.2 JavaScript API Surface

**Module Exports (generated by NAPI-RS):**

```typescript
// index.d.ts (TypeScript definitions)

export class AgentDB {
  /**
   * Create a new AgentDB instance
   * @param dbPath - Path to SQLite database file
   * @throws Error if database cannot be opened
   */
  constructor(dbPath: string);

  /**
   * Add a memory to the database
   * @param text - Memory text content
   * @param vector - 384-dimensional Float32Array
   * @returns Promise resolving to memory ID
   */
  addMemory(text: string, vector: Float32Array): Promise<number>;

  /**
   * Get all memories from database
   * @returns Promise resolving to array of Memory objects
   */
  getAllMemories(): Promise<Array<Memory>>;

  /**
   * Add or update a threat signature
   * @param pattern - Threat pattern text
   * @param vector - 384-dimensional Float32Array
   * @param score - Threat score (0.0 to 1.0)
   * @param action - Mitigation action
   * @returns Promise resolving to signature ID
   */
  addSignature(
    pattern: string,
    vector: Float32Array,
    score: number,
    action: string
  ): Promise<number>;

  /**
   * Check if input matches known threats
   * @param inputVector - 384-dimensional Float32Array
   * @returns Promise resolving to matching Signature or null
   */
  checkImmunity(inputVector: Float32Array): Promise<Signature | null>;

  /**
   * Calculate cosine similarity between vectors
   * @param a - First vector (Float32Array)
   * @param b - Second vector (Float32Array)
   * @returns Similarity score (0.0 to 1.0)
   */
  cosineSimilarity(a: Float32Array, b: Float32Array): number;

  /**
   * Get signature by ID
   * @param id - Signature ID
   * @returns Promise resolving to Signature or null
   */
  getSignatureById(id: number): Promise<Signature | null>;
}

export interface Memory {
  id: number;
  text: string;
  vector: Float32Array;
  created_at: string;
}

export interface Signature {
  id: number;
  pattern_text: string;
  vector: Float32Array;
  threat_score: number;
  mitigation_action: string;
  encounter_count: number;
  created_at: string;
}
```

### 6.3 NAPI-RS Implementation Pattern

**Example Structure (lib.rs):**

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub struct AgentDB {
    db_path: String,
    // Internal SQLite connection (use rusqlite crate)
}

#[napi]
impl AgentDB {
    #[napi(constructor)]
    pub fn new(db_path: String) -> Result<Self> {
        // Initialize database connection
        // Create tables if not exist
        Ok(AgentDB { db_path })
    }

    #[napi]
    pub async fn add_memory(
        &self,
        text: String,
        vector: Float32Array,
    ) -> Result<i64> {
        // Convert Float32Array to Vec<f32>
        let vector_slice = vector.as_ref();
        // Call internal add_memory function
    }

    // ... other methods
}

// Helper: Convert JS Float32Array to Rust Vec<f32>
fn js_array_to_vec(arr: Float32Array) -> Vec<f32> {
    arr.as_ref().to_vec()
}

// Helper: Convert Rust Vec<f32> to JS Float32Array
fn vec_to_js_array(env: Env, vec: Vec<f32>) -> Result<Float32Array> {
    Float32Array::new(env, vec)
}
```

### 6.4 Async/Await Support

**Requirements:**
- All database operations must be async to avoid blocking Node.js event loop
- Use `tokio` runtime for async SQLite operations
- NAPI-RS `async fn` generates JavaScript Promises automatically

**Example:**
```rust
#[napi]
impl AgentDB {
    #[napi]
    pub async fn get_all_memories(&self) -> Result<Vec<JsMemory>> {
        tokio::task::spawn_blocking(move || {
            // SQLite operations on background thread
            // Prevent blocking event loop
        }).await?
    }
}
```

---

## 7. Xenova Embeddings Integration

### 7.1 Current Integration Point

**File:** `agents/memory-agent/index.js`

**Embedding Generation:**
```javascript
// Line 4: Import Rust Vector Engine
import { VectorEngine } from '../../aimds-rust/index.js';

// Line 23: Initialize
const vectorEngine = new VectorEngine();

// Line 54: Generate embedding
const vector = vectorEngine.getVector(contentStr);
```

**VectorEngine Interface (aimds-rust/src/lib.rs):**
```rust
#[napi]
pub struct VectorEngine {
    model: BertModel,
    tokenizer: Tokenizer,
}

#[napi]
impl VectorEngine {
    #[napi(constructor)]
    pub fn new(model_path: String) -> Result<Self> {
        // Load model from model_path
        // Default: "model/" directory with config.json, tokenizer.json, model.safetensors
    }

    #[napi]
    pub fn get_vector(&self, text: String) -> Result<Vec<f64>> {
        // Tokenize text
        // Run through BERT model
        // Mean pooling of token embeddings
        // Return 384-dimensional vector
    }
}
```

### 7.2 Integration Requirements for AgentDB

**Embedding Source:**
- AgentDB should **NOT** include embedding generation
- Embeddings are generated externally by `VectorEngine`
- AgentDB receives pre-computed vectors as input

**Data Flow:**
```
User Input → VectorEngine.getVector() → Float32Array[384]
                                              ↓
                                    AgentDB.addMemory(text, vector)
                                              ↓
                                    SQLite Database (BLOB storage)
```

**Type Conversion:**
```javascript
// Current: VectorEngine returns Float64Array (Vec<f64>)
const vector = vectorEngine.getVector("text"); // Float64Array[384]

// Convert to Float32Array for storage
const vector32 = new Float32Array(vector);

// Pass to AgentDB
await agentDB.addMemory("text", vector32);
```

### 7.3 Model Configuration

**Model Details:**
- Name: `nreimers/MiniLM-L6-H384-uncased`
- Architecture: BERT (6 layers, 12 attention heads)
- Hidden size: 384 dimensions
- Max sequence length: 512 tokens
- Vocabulary size: 30,522 tokens

**File Locations:**
- Config: `aimds-rust/model/config.json`
- Tokenizer: `aimds-rust/model/tokenizer.json`
- Weights: `aimds-rust/model/model.safetensors` (90.8 MB)

**Initialization in logic.js:**
```javascript
// agents/memory-agent/index.js (line 23)
const vectorEngine = new VectorEngine("./aimds-rust/model");
```

### 7.4 Future Considerations

**Model Upgrades:**
- If switching to different embedding model (e.g., 768 dimensions)
- AgentDB must support configurable vector dimensions
- Add migration tool to re-embed existing memories

**Batching:**
- VectorEngine could support batch embedding for performance
- AgentDB should support bulk insert operations

---

## 8. Database Schema Requirements

### 8.1 SQLite Schema Definition

**Table: memories**
```sql
CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    vector BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Table: signatures**
```sql
CREATE TABLE IF NOT EXISTS signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_text TEXT UNIQUE NOT NULL,
    vector BLOB NOT NULL,
    threat_score REAL NOT NULL CHECK(threat_score >= 0.0 AND threat_score <= 1.0),
    mitigation_action TEXT NOT NULL,
    encounter_count INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Indexes (for future optimization):**
```sql
-- Index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS idx_memories_created
ON memories(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_signatures_created
ON signatures(created_at DESC);

-- Index on mitigation action for filtering
CREATE INDEX IF NOT EXISTS idx_signatures_action
ON signatures(mitigation_action);
```

### 8.2 Vector Serialization Format

**BLOB Storage Format:**
- Little-endian f32 encoding
- 384 dimensions × 4 bytes = 1,536 bytes per vector
- No compression (for speed)

**Serialization Functions:**
```rust
/// Convert Vec<f32> to BLOB bytes
fn serialize_vector(vec: &[f32]) -> Vec<u8> {
    vec.iter()
        .flat_map(|f| f.to_le_bytes())
        .collect()
}

/// Convert BLOB bytes to Vec<f32>
fn deserialize_vector(bytes: &[u8]) -> Result<Vec<f32>, Error> {
    if bytes.len() != 384 * 4 {
        return Err(Error::InvalidVectorSize(bytes.len()));
    }

    Ok(bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}
```

### 8.3 Migration Compatibility

**Database File Location:**
- Current: `agents/memory-agent/memories.db`
- Must remain compatible with existing database files
- No breaking schema changes without migration tool

**Migration Considerations:**
- If vector dimension changes: Provide re-embedding script
- If new columns added: Use `ALTER TABLE` with defaults
- Backward compatibility: Support reading old schema

---

## 9. Error Handling Requirements

### 9.1 Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum AgentDBError {
    #[error("Vector dimension mismatch: expected {expected}, got {actual}")]
    DimensionMismatch { expected: usize, actual: usize },

    #[error("Invalid vector dimension: {0}, expected 384")]
    InvalidDimension(usize),

    #[error("Database error: {0}")]
    DatabaseError(#[from] rusqlite::Error),

    #[error("Invalid threat score: {0}, must be in range [0.0, 1.0]")]
    InvalidThreatScore(f32),

    #[error("Invalid mitigation action: {0}")]
    InvalidMitigationAction(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Vector contains NaN or Infinity")]
    InvalidVectorValues,

    #[error("Empty text provided")]
    EmptyText,
}
```

### 9.2 Error Handling Strategy

**Recoverable Errors:**
- Database locked: Retry with exponential backoff
- Empty results: Return empty Vec or None (not error)
- Dimension warnings: Log warning but continue if >0

**Fatal Errors:**
- Invalid database path: Panic or return error to caller
- Corrupted BLOB data: Return error, do not attempt recovery
- Out of memory: Allow Rust panic propagation

**JavaScript Error Mapping:**
```rust
impl From<AgentDBError> for napi::Error {
    fn from(err: AgentDBError) -> Self {
        napi::Error::from_reason(err.to_string())
    }
}
```

---

## 10. Testing Requirements

### 10.1 Unit Tests (Rust)

**Test Coverage:**
- Vector serialization/deserialization
- Cosine similarity accuracy
- Dimension validation
- Error handling for all error types
- SIMD optimizations (compare with scalar baseline)

**Example Test:**
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical_vectors() {
        let vec = vec![0.1; 384];
        let similarity = cosine_similarity(&vec, &vec).unwrap();
        assert!((similarity - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_dimension_mismatch_error() {
        let vec_a = vec![0.1; 384];
        let vec_b = vec![0.1; 256];
        assert!(matches!(
            cosine_similarity(&vec_a, &vec_b),
            Err(AgentDBError::DimensionMismatch { .. })
        ));
    }
}
```

### 10.2 Integration Tests (Node.js)

**Test Files:**
- `tests/unit/db_vector.test.js` (10 tests)
- `tests/integration/full_loop.test.js` (10 tests)

**Test Scenarios:**
1. Add memory and retrieve by ID
2. Vector similarity matching
3. Immunity system with threshold checks
4. UPSERT logic for duplicate patterns
5. Empty database handling
6. Concurrent access (multi-threaded)
7. Large dataset performance (1000+ memories)

**Example Test:**
```javascript
// From tests/unit/db_vector.test.js
test('addSignature should accept and store vector parameter', async () => {
    const pattern = "DROP TABLE users";
    const vector = new Float32Array([0.1, 0.2, 0.3, /* ... 384 dims */]);
    const score = 0.95;
    const action = "BLOCK";

    const result = await agentDB.addSignature(pattern, vector, score, action);

    expect(result).toBeDefined();
    expect(typeof result).toBe('number');
});
```

### 10.3 Performance Benchmarks

**Benchmark Targets:**
- Cosine similarity: <100 microseconds per calculation (SIMD)
- Memory insertion: <5ms per memory (including serialization)
- Immunity check (100 signatures): <10ms
- Batch search (1000 memories): <500ms

**Benchmark Tools:**
- Rust: `criterion` crate for micro-benchmarks
- Node.js: `benchmark.js` for integration benchmarks

---

## 11. Performance Requirements

### 11.1 Latency Targets

| Operation | Target Latency | Current (JS) | Expected Rust |
|-----------|----------------|--------------|---------------|
| `cosineSimilarity` | <100 μs | ~500 μs | <50 μs |
| `addMemory` | <5 ms | ~8 ms | <3 ms |
| `getAllMemories` (100 items) | <10 ms | ~25 ms | <8 ms |
| `checkImmunity` (100 sigs) | <10 ms | ~40 ms | <8 ms |
| `checkImmunity` (1000 sigs) | <50 ms | ~400 ms | <40 ms |

### 11.2 Throughput Targets

- Memory insertions: >200 ops/second
- Similarity calculations: >10,000 ops/second
- Concurrent reads: >500 ops/second (read-heavy workload)

### 11.3 Memory Usage

- Memory overhead per vector: 1,536 bytes (vector) + ~100 bytes (metadata)
- Maximum database size: 10 GB (safety limit)
- Maximum vectors in memory: Limited by SQLite, not by Rust code

---

## 12. Build and Deployment Requirements

### 12.1 Build Configuration

**Cargo.toml:**
```toml
[package]
name = "agentdb-rust"
version = "1.0.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2.12.0", features = ["default", "async"] }
napi-derive = "2.12.0"
rusqlite = { version = "0.30", features = ["bundled"] }
tokio = { version = "1.35", features = ["rt-multi-thread"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
thiserror = "1.0"

[build-dependencies]
napi-build = "2.0.1"

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
```

**package.json:**
```json
{
  "name": "agentdb-rust",
  "version": "1.0.0",
  "description": "High-performance vector memory database for AI agents",
  "main": "index.js",
  "types": "index.d.ts",
  "napi": {
    "name": "agentdb-rust",
    "triples": {
      "additional": [
        "aarch64-apple-darwin",
        "x86_64-unknown-linux-gnu",
        "x86_64-pc-windows-msvc"
      ]
    }
  },
  "scripts": {
    "build": "napi build --platform --release",
    "build:debug": "napi build --platform",
    "test": "npm run build && jest"
  }
}
```

### 12.2 CI/CD Pipeline

**Build Stages:**
1. Rust unit tests (`cargo test`)
2. Clippy linting (`cargo clippy -- -D warnings`)
3. Format check (`cargo fmt -- --check`)
4. NAPI build for all platforms
5. Node.js integration tests
6. Performance benchmarks (regression detection)

**Platform Builds:**
- Linux x64 (primary development platform)
- macOS x64 and ARM64 (Apple Silicon)
- Windows x64

---

## 13. Documentation Requirements

### 13.1 Code Documentation

**Rust:**
- Every public function must have doc comments
- Include examples in doc comments
- Use `cargo doc` to generate HTML docs

**TypeScript:**
- Type definitions in `index.d.ts`
- JSDoc comments for all exports
- Usage examples in README

### 13.2 User Documentation

**README.md:**
1. Installation instructions
2. Quick start example
3. API reference
4. Performance benchmarks
5. Migration guide from JavaScript version

**ARCHITECTURE.md:**
1. System design overview
2. Data flow diagrams
3. Performance optimization strategies
4. Future roadmap

---

## 14. Success Criteria

### 14.1 Functional Requirements

- [ ] All 20 existing tests pass (10 unit + 10 integration)
- [ ] API-compatible with `agents/memory-agent/db.js`
- [ ] Cosine similarity accuracy: >99.99% match with JavaScript version
- [ ] Database schema backward compatible

### 14.2 Performance Requirements

- [ ] >3x speedup on `checkImmunity` (100 signatures)
- [ ] >5x speedup on `cosineSimilarity` (SIMD enabled)
- [ ] <5ms latency for memory insertion
- [ ] Memory usage: <20% increase vs JavaScript version

### 14.3 Quality Requirements

- [ ] 100% test coverage on core functions
- [ ] Zero clippy warnings
- [ ] Zero memory leaks (valgrind clean)
- [ ] Documentation coverage >90%

---

## 15. Risk Assessment

### 15.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| SIMD not available on target platform | Low | Medium | Fallback to scalar implementation |
| SQLite bundled build issues | Medium | High | Test on all platforms early |
| NAPI-RS async deadlocks | Low | High | Use tokio blocking pool |
| Float precision differences (f32 vs f64) | Medium | Low | Extensive testing with tolerance |

### 15.2 Schedule Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WASM binding complexity | Medium | Medium | Allocate extra time for learning |
| Performance targets not met | Low | High | Early benchmarking, iterative optimization |
| Test migration effort underestimated | Medium | Low | Prioritize test porting |

---

## 16. Next Steps

### 16.1 Phase 1: Architecture (Week 1)

1. Design Rust module structure
2. Define internal data structures
3. Create build pipeline
4. Set up benchmarking framework

### 16.2 Phase 2: Core Implementation (Week 2-3)

1. Implement database initialization
2. Implement vector serialization
3. Implement cosine similarity (scalar + SIMD)
4. Implement CRUD operations

### 16.3 Phase 3: Integration (Week 4)

1. NAPI-RS bindings
2. TypeScript definitions
3. Integration with VectorEngine
4. Migration from JavaScript version

### 16.4 Phase 4: Testing & Optimization (Week 5)

1. Port all existing tests
2. Performance benchmarking
3. Optimization based on profiling
4. Documentation finalization

---

## Appendix A: Reference Code Locations

**Current Implementation:**
- Database: `/workspaces/turbo-flow-claude/agents/memory-agent/db.js`
- Logic: `/workspaces/turbo-flow-claude/agents/memory-agent/index.js`
- API: `/workspaces/turbo-flow-claude/agents/memory-agent/api.js`

**Vector Engine:**
- Rust: `/workspaces/turbo-flow-claude/aimds-rust/src/lib.rs`
- Model: `/workspaces/turbo-flow-claude/aimds-rust/model/`

**Tests:**
- Unit: `/workspaces/turbo-flow-claude/tests/unit/db_vector.test.js`
- Integration: `/workspaces/turbo-flow-claude/tests/integration/full_loop.test.js`

**Configuration:**
- Model Config: `/workspaces/turbo-flow-claude/aimds-rust/model/config.json`
- Hidden Size: 384 dimensions (line 10)

---

## Appendix B: Key Constants

```rust
/// Vector dimension for Xenova/all-MiniLM-L6-v2 model
pub const EXPECTED_VECTOR_DIMENSION: usize = 384;

/// Default immunity check similarity threshold
pub const DEFAULT_IMMUNITY_THRESHOLD: f32 = 0.65;

/// Maximum number of signatures to check (safety limit)
pub const MAX_SIGNATURES: usize = 10_000;

/// Database retry attempts on lock
pub const DB_RETRY_ATTEMPTS: usize = 3;

/// Retry backoff delay (milliseconds)
pub const RETRY_BACKOFF_MS: u64 = 100;
```

---

## Appendix C: Example Usage

**JavaScript (Node.js):**
```javascript
import { AgentDB } from 'agentdb-rust';
import { VectorEngine } from 'aimds-rust';

// Initialize
const db = new AgentDB('./memories.db');
const vectorEngine = new VectorEngine('./model');

// Add memory
const text = "Rust is fast and memory-safe";
const vector = vectorEngine.getVector(text);
const vector32 = new Float32Array(vector);
const id = await db.addMemory(text, vector32);

// Search for similar memories
const queryVector = vectorEngine.getVector("Rust programming");
const memories = await db.getAllMemories();

const results = memories.map(mem => ({
    memory: mem,
    similarity: db.cosineSimilarity(new Float32Array(queryVector), mem.vector)
})).sort((a, b) => b.similarity - a.similarity);

console.log('Top match:', results[0]);

// Check immunity
const inputVector = vectorEngine.getVector("DROP TABLE users");
const threat = await db.checkImmunity(new Float32Array(inputVector));
if (threat) {
    console.log(`Threat detected: ${threat.mitigation_action}`);
}
```

---

**Document End**

---

## Metadata

**Document Version:** 1.0
**Last Updated:** 2026-01-03
**Approval Status:** Draft for Review
**Stakeholders:** Rust Architect, Development Team, QA Team
**Related Documents:**
- `/workspaces/turbo-flow-claude/agents/memory-agent/db.js` (Current Implementation)
- `/workspaces/turbo-flow-claude/aimds-rust/src/lib.rs` (Vector Engine Reference)
- `/workspaces/turbo-flow-claude/tests/unit/db_vector.test.js` (Test Specifications)
