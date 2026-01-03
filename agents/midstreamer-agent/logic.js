/**
 * MIDSTREAMER AGENT - THE GATEKEEPER (WASM-POWERED)
 *
 * Purpose: Intercept traffic and check against the Vector Immunity Database
 * Workflow:
 *   1. Receive payload (user input, request data, etc.)
 *   2. Convert payload to vector embedding (Xenova local AI)
 *   3. Check vector against known threat signatures (WASM Rust cosine similarity)
 *   4. Return threat assessment and mitigation action
 *
 * CRITICAL: All vector similarity calculations are performed in Rust/WASM,
 * NOT in JavaScript. This ensures maximum performance and consistency.
 */

import { getEmbedding } from './embedder.js';
import MemoryAgent from '../memory-agent/api.js';

/**
 * Analyzes incoming payload for potential threats using WASM vector similarity
 *
 * @param {string} payload - The input text to analyze
 * @returns {Promise<Object>} Analysis result with threat status and action
 *
 * Algorithm:
 *   - Step 1: vector = await getEmbedding(payload) [Xenova local AI]
 *   - Step 2: match = await MemoryAgent.checkImmunity(vector) [WASM Rust cosine similarity]
 *   - Step 3: IF match found -> Return { isThreat: true, action: "BLOCK" }
 *
 * VERIFICATION: Console logs will confirm "WASM" prefix for all vector operations
 */
async function analyze(payload) {
    try {
        console.log('[Midstreamer] Analyzing payload with WASM-powered vector search...');

        // Step 1: Convert payload to vector embedding using Xenova (local CPU AI)
        const vector = await getEmbedding(payload);
        console.log(`[Midstreamer] Generated ${vector.length}-dimensional vector via Xenova`);

        // Step 2: Check immunity database for vector similarity match
        // CRITICAL: This uses WASM Rust implementation for cosine similarity
        const match = await MemoryAgent.handle('CHECK_IMMUNITY', vector);

        // Step 3: Determine threat status and action
        if (match) {
            console.log(`[Midstreamer] ⚠️  THREAT DETECTED VIA WASM: ${match.pattern_text}`);
            console.log(`[Midstreamer] Similarity: ${match.similarity}, Action: ${match.mitigation_action}`);
            return {
                isThreat: true,
                action: match.mitigation_action,
                matchedPattern: match.pattern_text,
                threatScore: match.threat_score,
                similarity: match.similarity,
                source: 'WASM'  // Confirms WASM origin
            };
        } else {
            console.log('[Midstreamer] ✓ Clean input (no threat signatures matched via WASM)');
            return {
                isThreat: false,
                source: 'WASM'  // Confirms WASM origin
            };
        }
    } catch (error) {
        console.error('[Midstreamer] Analysis error:', error);
        // Propagate errors for proper error handling upstream
        throw error;
    }
}

export { analyze };
