import * as db from './db.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Reuse the API key from the environment
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "embedding-001" });

async function getEmbedding(text) {
    const result = await model.embedContent(text);
    return result.embedding.values;
}

// Euclidean Distance (Vector Math)
function euclideanDistance(a, b) {
    return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i], 2), 0));
}

async function handle(task, input) {
    try {
        // --- EXISTING MEMORY TASKS ---
        if (task === 'LEARN') {
            const vector = await getEmbedding(input);
            await db.addMemory(input, vector);
            return "Memory Saved.";
        }
        
        if (task === 'RECALL') {
            const queryVector = await getEmbedding(input);
            const allMemories = await db.getAllMemories();
            if (allMemories.length === 0) return "No memories found.";

            const scored = allMemories.map(m => ({
                text: m.text,
                score: euclideanDistance(queryVector, m.vector)
            })).sort((a, b) => a.score - b.score);

            return scored.slice(0, 3).map(m => m.text).join("\n");
        }

        // --- NEW IMMUNITY TASKS ---
        if (task === 'CHECK_IMMUNITY') {
            return await db.checkImmunity(input);
        }

        if (task === 'ADD_SIGNATURE') {
            return await db.addSignature(input.pattern, input.vector, input.score, input.action);
        }

        if (task === 'GET_EMBEDDING') {
            return await getEmbedding(input);
        }

        return "Unknown Memory Task";
    } catch (e) {
        return `Memory Error: ${e.message}`;
    }
}

export default { handle };
