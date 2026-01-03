import sqlite3Pkg from 'sqlite3';
const sqlite3 = sqlite3Pkg.verbose();
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Always locate memories.db in THIS folder
const dbPath = path.join(__dirname, 'memories.db');
const db = new sqlite3.Database(dbPath);

/**
 * VECTOR EMBEDDING CONFIGURATION
 * ================================
 * Model: Xenova/all-MiniLM-L6-v2
 * Expected Dimensions: 384
 *
 * All vectors stored in this database MUST be 384-dimensional Float32Arrays.
 * This applies to both:
 * - memories.vector (general memory embeddings)
 * - signatures.vector (immunity pattern embeddings)
 *
 * Previous versions used 768 dimensions. If migrating data, vectors must be re-embedded.
 */
const EXPECTED_VECTOR_DIMENSION = 384;

function initDB() {
    db.serialize(() => {
        // 1. General Memories (Facts/Logs)
        db.run(`CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            vector BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 2. NEW: Immunity Signatures (The "Antibodies")
        // Stores patterns of inputs that were previously identified as attacks
        db.run(`CREATE TABLE IF NOT EXISTS signatures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_text TEXT UNIQUE,  -- The malicious input snippet
            vector BLOB,               -- Vector embedding for similarity matching
            threat_score REAL,         -- 0.0 to 1.0 (1.0 = confirmed attack)
            mitigation_action TEXT,    -- e.g., "BLOCK", "SANITIZE"
            encounter_count INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
}

// Helper: Float32Array <-> Buffer
function float32ToBuffer(floatArray) { return Buffer.from(floatArray.buffer); }
function bufferToFloat32(buffer) { return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4); }

// --- MEMORY FUNCTIONS ---
function addMemory(text, vector) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO memories (text, vector) VALUES (?, ?)");
        stmt.run(text, float32ToBuffer(vector), function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
        stmt.finalize();
    });
}

function getAllMemories() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM memories", (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => ({ ...row, vector: bufferToFloat32(row.vector) })));
        });
    });
}

/**
 * Cosine Similarity: Measures angle between vectors (0.0 to 1.0)
 * Formula: dot(a,b) / (norm(a) * norm(b))
 *
 * NOTE: Expects 384-dimensional vectors from Xenova/all-MiniLM-L6-v2 model
 */
function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error(`Vectors must have same length. Got ${a.length} and ${b.length}. Expected ${EXPECTED_VECTOR_DIMENSION} dimensions.`);
    }

    // Validate expected dimension
    if (a.length !== EXPECTED_VECTOR_DIMENSION) {
        console.warn(`Warning: Vector dimension ${a.length} does not match expected ${EXPECTED_VECTOR_DIMENSION} for Xenova/all-MiniLM-L6-v2`);
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (normA * normB);
}

// --- IMMUNITY FUNCTIONS (NEW) ---
function checkImmunity(inputVector) {
    return new Promise((resolve, reject) => {
        // Vector-based similarity matching with 0.92 threshold
        db.all("SELECT * FROM signatures", (err, rows) => {
            if (err) {
                reject(err);
                return;
            }

            if (!rows || rows.length === 0) {
                resolve(null);
                return;
            }

            let bestMatch = null;
            let highestSimilarity = 0;

            for (const row of rows) {
                if (!row.vector) continue;

                const storedVector = bufferToFloat32(row.vector);
                const similarity = cosineSimilarity(inputVector, storedVector);

                 if (similarity > 0.65 && similarity > highestSimilarity) {
                    highestSimilarity = similarity;
                    bestMatch = row;
                }
            }

            resolve(bestMatch);
        });
    });
}

function addSignature(pattern, vector, score, action) {
    return new Promise((resolve, reject) => {
        // If pattern exists, just increment the counter (upsert logic)
        const stmt = db.prepare(`
            INSERT INTO signatures (pattern_text, vector, threat_score, mitigation_action)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(pattern_text) DO UPDATE SET
                vector = excluded.vector,
                encounter_count = encounter_count + 1
        `);
        stmt.run(pattern, float32ToBuffer(vector), score, action, function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
        stmt.finalize();
    });
}

function getSignatureById(id) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM signatures WHERE id = ?", [id], (err, row) => {
            if (err) reject(err);
            else if (row && row.vector) {
                resolve({ ...row, vector: bufferToFloat32(row.vector) });
            } else {
                resolve(row);
            }
        });
    });
}

function hasVectorColumn() {
    return new Promise((resolve, reject) => {
        db.get("PRAGMA table_info(signatures)", (err, row) => {
            if (err) reject(err);
            else {
                db.all("PRAGMA table_info(signatures)", (err, columns) => {
                    if (err) reject(err);
                    else {
                        const hasVector = columns.some(col => col.name === 'vector');
                        resolve(hasVector);
                    }
                });
            }
        });
    });
}

/**
 * Generate a mock embedding vector for testing purposes
 * Returns a 384-dimensional Float32Array (matching Xenova/all-MiniLM-L6-v2 output)
 *
 * WARNING: This is for testing/fallback only. Production code should use real embeddings
 * from the Xenova/all-MiniLM-L6-v2 model.
 *
 * @param {string} text - Text to generate mock embedding for (currently unused, for API compatibility)
 * @returns {Float32Array} 384-dimensional normalized vector
 */
function generateMockEmbedding(text = '') {
    const vector = new Float32Array(EXPECTED_VECTOR_DIMENSION);

    // Generate pseudo-random but deterministic values based on text hash
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
        seed = (seed * 31 + text.charCodeAt(i)) % 1000000;
    }

    // Fill with pseudo-random values using simple LCG
    let rng = seed || 42;
    for (let i = 0; i < EXPECTED_VECTOR_DIMENSION; i++) {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        vector[i] = (rng / 2147483648) * 2 - 1; // Range: [-1, 1]
    }

    // Normalize to unit vector (important for cosine similarity)
    let norm = 0;
    for (let i = 0; i < EXPECTED_VECTOR_DIMENSION; i++) {
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
        for (let i = 0; i < EXPECTED_VECTOR_DIMENSION; i++) {
            vector[i] /= norm;
        }
    }

    return vector;
}

initDB();

export {
    addMemory,
    getAllMemories,
    checkImmunity,
    addSignature,
    getSignatureById,
    hasVectorColumn,
    cosineSimilarity,
    generateMockEmbedding,
    EXPECTED_VECTOR_DIMENSION
};
