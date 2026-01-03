/**
 * WASM-POWERED VECTOR DATABASE
 *
 * This module wraps the Rust/WASM AgentDB for vector similarity operations.
 * ALL cosine similarity calculations are performed in Rust (not JavaScript).
 */

import { AgentDB } from '../../agentdb_core/pkg/agentdb_core.js';

let db = null;

/**
 * Initialize the WASM database
 * @returns {Promise<AgentDB>} Initialized WASM database instance
 */
async function initDB() {
    if (!db) {
        try {
            console.log('[WASM-DB] Initializing Rust/WASM vector database...');
            db = new AgentDB();
            console.log('[WASM-DB] Database initialized successfully');
            console.log(`[WASM-DB] Stats: ${db.get_stats()}`);
        } catch (error) {
            console.error('[WASM-DB] Failed to initialize WASM module:', error);
            throw new Error(`WASM initialization failed: ${error.message}`);
        }
    }
    return db;
}

/**
 * Add a memory record
 * @param {string} text - Memory text
 * @param {Float32Array} vector - 384-dimensional embedding vector
 * @returns {Promise<number>} Memory ID
 */
async function addMemory(text, vector) {
    const database = await initDB();

    // Convert Float32Array to regular array for WASM
    const vectorArray = Array.from(vector);

    const id = database.add_memory(text, vectorArray);
    console.log(`[WASM-DB] Memory added with ID: ${id}`);
    return id;
}

/**
 * Check if input matches known threat signatures (WASM cosine similarity)
 * @param {Float32Array} inputVector - Input embedding vector
 * @returns {Promise<Object|null>} Threat match or null
 */
async function checkImmunity(inputVector) {
    const database = await initDB();

    // Convert Float32Array to regular array for WASM
    const vectorArray = Array.from(inputVector);

    const result = database.check_immunity(vectorArray);

    if (result) {
        const match = JSON.parse(result);
        console.log(`[WASM-DB] THREAT DETECTED via WASM: ${match.pattern_text} (similarity: ${match.similarity})`);
        return {
            id: match.id,
            pattern_text: match.pattern_text,
            threat_score: match.threat_score,
            mitigation_action: match.mitigation_action,
            encounter_count: match.encounter_count,
            similarity: match.similarity
        };
    }

    return null;
}

/**
 * Add a threat signature
 * @param {string} pattern - Threat pattern text
 * @param {Float32Array} vector - Pattern embedding vector
 * @param {number} score - Threat score (0.0 to 1.0)
 * @param {string} action - Mitigation action (e.g., "BLOCK")
 * @returns {Promise<number>} Signature ID
 */
async function addSignature(pattern, vector, score, action) {
    const database = await initDB();

    // Convert Float32Array to regular array for WASM
    const vectorArray = Array.from(vector);

    const id = database.add_signature(pattern, vectorArray, score, action);
    console.log(`[WASM-DB] Signature added with ID: ${id}`);
    return id;
}

/**
 * Search for similar memories (WASM cosine similarity)
 * @param {Float32Array} queryVector - Query embedding vector
 * @param {number} topN - Number of results to return
 * @returns {Promise<Array>} Top N similar memories
 */
async function searchMemories(queryVector, topN = 3) {
    const database = await initDB();

    // Convert Float32Array to regular array for WASM
    const vectorArray = Array.from(queryVector);

    const resultsJson = database.search_memories(vectorArray, topN);
    const results = JSON.parse(resultsJson);

    console.log(`[WASM-DB] Found ${results.length} similar memories via WASM`);
    return results;
}

/**
 * Get database statistics
 * @returns {Promise<Object>} Database stats
 */
async function getStats() {
    const database = await initDB();
    const statsJson = database.get_stats();
    return JSON.parse(statsJson);
}

/**
 * Calculate cosine similarity using WASM (Rust implementation)
 * @param {Float32Array} vecA - First vector
 * @param {Float32Array} vecB - Second vector
 * @returns {number} Similarity score (0.0 to 1.0)
 */
function cosineSimilarityWASM(vecA, vecB) {
    // Convert Float32Array to regular array for WASM
    const arrayA = Array.from(vecA);
    const arrayB = Array.from(vecB);

    const similarity = AgentDB.cosine_similarity(arrayA, arrayB);
    console.log(`[WASM-DB] Cosine similarity computed in RUST: ${similarity}`);
    return similarity;
}

export {
    initDB,
    addMemory,
    checkImmunity,
    addSignature,
    searchMemories,
    getStats,
    cosineSimilarityWASM
};
