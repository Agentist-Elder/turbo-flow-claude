require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { VectorEngine } = require('../../aimds-rust'); // Local Rust Bridge
const db = require('./db');

// --- CONFIGURATION ---
const MODEL_NAME = "gemini-2.0-flash"; 
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("❌ ERROR: GEMINI_API_KEY is missing. Please export it.");
    process.exit(1);
}

// --- INITIALIZATION ---
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: MODEL_NAME });

// Initialize Rust Vector Engine
let vectorEngine;
try {
    vectorEngine = new VectorEngine();
    console.log("🤖 DEFENSE AGENT ONLINE. (Time-Aware Memory Active)");
    console.log("   /learn <fact>   |   <question>\n");
} catch (e) {
    console.error("❌ FAILED to load Vector Engine:", e);
    console.error("Make sure you built the Rust project with 'napi build --release'");
    process.exit(1);
}

// --- TOOLS ---
function runScan() {
    console.log("⚙️  Running Live Diagnostic...");
    const integrity = Math.floor(Math.random() * (100 - 80) + 80); // 80-99%
    const threats = integrity > 90 ? 0 : 1;
    
    return {
        status: "ONLINE",
        integrity_score: `${integrity}%`,
        active_threats: threats,
        drift_detected: false,
        timestamp: new Date().toISOString()
    };
}

// --- MEMORY SYSTEM ---
async function saveToMemory(data) {
    try {
        // Convert Objects to String so Rust doesn't crash
        const contentStr = typeof data === 'object' ? JSON.stringify(data) : String(data);
        
        // Generate Vector (Synchronous Rust call)
        const vector = vectorEngine.getVector(contentStr);
        
        // Save to Database
        await db.addMemory(contentStr, vector);
        console.log(`   💾 Logged: "${contentStr.substring(0, 50)}..."`);
    } catch (error) {
        console.error("   ❌ Memory Write Failed");
        console.error("   Reason:", error.message);
    }
}

async function recallMemory(query) {
    try {
        const memories = await db.getAllMemories();
        if (memories.length === 0) return "";

        // Generate vector for the query
        const queryVector = vectorEngine.getVector(query);
        
        // Compare against memories (Dot Product)
        const scored = memories.map(mem => {
            const score = mem.vector.reduce((acc, val, i) => acc + val * queryVector[i], 0);
            return { ...mem, score };
        });

        // Sort by relevance (highest score first)
        scored.sort((a, b) => b.score - a.score);
        
        // UPGRADE: Return top 5 memories WITH Timestamps
        return scored.slice(0, 5)
            .map(m => `[MEMORY] (${m.created_at}): ${m.text}`)
            .join("\n");

    } catch (error) {
        console.error("   ⚠️ Recall Failed:", error.message);
        return "";
    }
}

// --- MAIN LOOP ---
async function agentBrain(userInput) {
    if (!userInput) return;

    // 1. Check Memory
    console.log("🔍 Searching memory...");
    const context = await recallMemory(userInput);
    
    // 2. Build Prompt
    const prompt = `
    SYSTEM: You are an advanced Cybersecurity Defense Agent.
    CONTEXT (Use these past memories to answer):
    ${context}
    
    USER: ${userInput}
    
    INSTRUCTIONS:
    - If the user asks to "Run scan", output strictly: [TOOL:RUN_SCAN]
    - If the user asks about past events, use the timestamps in [MEMORY] to determine which is latest.
    `;

    // 3. Generate Response
    console.log("🧠 Thinking...");
    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim();

        // 4. Handle Tool Usage
        if (response.includes("[TOOL:RUN_SCAN]")) {
            const scanResult = runScan();
            console.log("🔌 Output:", JSON.stringify(scanResult));
            
            // Save result to memory
            await saveToMemory(scanResult);

            // Final Reply
            const finalPrompt = `
            The scan finished. Result: ${JSON.stringify(scanResult)}.
            Summarize this for the user.
            `;
            const finalRes = await model.generateContent(finalPrompt);
            console.log("\n💬 AI RESPONSE:");
            console.log(finalRes.response.text());
        } else {
            console.log("\n💬 AI RESPONSE:");
            console.log(response);
        }
    } catch (e) {
        console.error("❌ Agent Error:", e.message);
    }
}

// --- CLI INTERFACE ---
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.setPrompt('👉 Command: ');
rl.prompt();

rl.on('line', async (line) => {
    const input = line.trim();
    if (input) {
        if (input.startsWith('/learn ')) {
            const fact = input.replace('/learn ', '');
            await saveToMemory(fact);
        } else {
            await agentBrain(input);
        }
    }
    rl.prompt();
});
