/**
 * MIDSTREAMER AGENT - THE GATEKEEPER
 *
 * Purpose: Intercept traffic and check against the Vector Immunity Database
 * Workflow:
 *   1. Receive payload (user input, request data, etc.)
 *   2. Convert payload to vector embedding
 *   3. Check vector against known threat signatures
 *   4. Return threat assessment and mitigation action
 */

import { getEmbedding } from './embedder.js';
import MemoryAgent from '../memory-agent/api.js';

/**
 * Analyzes incoming payload for potential threats using vector similarity
 *
 * @param {string} payload - The input text to analyze
 * @returns {Promise<Object>} Analysis result with threat status and action
 *
 * Algorithm (per spec.md):
 *   - step 1: vector = await MemoryAgent.getEmbedding(payload)
 *   - step 2: match = await MemoryAgent.checkImmunity(vector)
 *   - step 3: IF match found -> Return { isThreat: true, action: "BLOCK" }
 */
async function analyze(payload) {
    try {
        // Step 1: Convert payload to vector embedding using REAL local AI
        const vector = await getEmbedding(payload);

        // Step 2: Check immunity database for vector similarity match
        const match = await MemoryAgent.handle('CHECK_IMMUNITY', vector);

        // Step 3: Determine threat status and action
        if (match) {
            return {
                isThreat: true,
                action: match.mitigation_action,
                matchedPattern: match.pattern_text,
                threatScore: match.threat_score
            };
        } else {
            return {
                isThreat: false
            };
        }
    } catch (error) {
        // Propagate errors for proper error handling upstream
        throw error;
    }
}

export { analyze };
