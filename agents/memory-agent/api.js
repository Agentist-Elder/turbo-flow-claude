/**
 * MEMORY AGENT API - WASM-POWERED
 *
 * This API now uses the Rust/WASM AgentDB for all vector operations.
 * Cosine similarity calculations are performed in Rust, not JavaScript.
 */

import * as db from './wasm-db.js';
import { getEmbedding } from '../midstreamer-agent/embedder.js';

async function handle(task, input) {
    try {
        console.log(`[Memory Agent API] Handling task: ${task}`);

        // --- MEMORY TASKS (WASM-POWERED) ---
        if (task === 'LEARN') {
            // Use Xenova embeddings (local CPU)
            const vector = await getEmbedding(input);
            await db.addMemory(input, vector);
            console.log('[Memory Agent API] Memory saved via WASM');
            return "Memory Saved (WASM-powered).";
        }

        if (task === 'RECALL') {
            const queryVector = await getEmbedding(input);

            // Use WASM search (Rust cosine similarity)
            const results = await db.searchMemories(queryVector, 3);

            if (results.length === 0) {
                return "No memories found.";
            }

            console.log(`[Memory Agent API] Retrieved ${results.length} memories via WASM`);
            return results.map(r => `[${r.score.toFixed(3)}] ${r.text}`).join("\n");
        }

        // --- IMMUNITY TASKS (WASM-POWERED) ---
        if (task === 'CHECK_IMMUNITY') {
            // Input should already be a vector (Float32Array)
            const match = await db.checkImmunity(input);
            if (match) {
                console.log(`[Memory Agent API] WASM threat detected: ${match.pattern_text}`);
            }
            return match;
        }

        if (task === 'ADD_SIGNATURE') {
            // input = { pattern, vector, score, action }
            const id = await db.addSignature(
                input.pattern,
                input.vector,
                input.score,
                input.action
            );
            console.log(`[Memory Agent API] Signature added via WASM (ID: ${id})`);
            return id;
        }

        if (task === 'GET_EMBEDDING') {
            // Use Xenova for embeddings
            const vector = await getEmbedding(input);
            console.log(`[Memory Agent API] Generated ${vector.length}-dim embedding`);
            return vector;
        }

        if (task === 'GET_STATS') {
            const stats = await db.getStats();
            console.log(`[Memory Agent API] Database stats:`, stats);
            return stats;
        }

        return "Unknown Memory Task";
    } catch (e) {
        console.error(`[Memory Agent API] Error:`, e);
        return `Memory Error: ${e.message}`;
    }
}

export default { handle };
