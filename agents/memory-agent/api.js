require('dotenv').config({ path: '../../.env' });
const { VectorEngine } = require('../../aimds-rust');
const db = require('./db');

let vectorEngine = null;

async function init() {
    if (!vectorEngine) {
        try {
            vectorEngine = new VectorEngine();
        } catch (e) {
            console.error("   [Memory-Agent] Brain Error:", e);
        }
    }
}

async function handle(task, input) {
    await init();

    if (task === 'LEARN') {
        const str = typeof input === 'object' ? JSON.stringify(input) : String(input);
        const vector = vectorEngine.getVector(str);
        await db.addMemory(str, vector);
        return { status: "success", message: "Memory saved." };
    }

    if (task === 'RECALL') {
        const memories = await db.getAllMemories();
        if (memories.length === 0) return "No memories found.";

        const queryVector = vectorEngine.getVector(input);
        const scored = memories.map(mem => {
            const score = mem.vector.reduce((acc, val, i) => acc + val * queryVector[i], 0);
            return { ...mem, score };
        });
        scored.sort((a, b) => b.score - a.score);

        // Return top 3 results
        return scored.slice(0, 3).map(m => `[${m.created_at}]: ${m.text}`).join("\n");
    }
    return { error: "Unknown task" };
}

module.exports = { handle };
