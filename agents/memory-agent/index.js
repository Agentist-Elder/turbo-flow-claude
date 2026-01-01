const axios = require('axios');
const readline = require('readline');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { addMemory, getAllMemories } = require('./db');

// --- CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 🛠️ TOOLS ( The "Hands" ) ---
const tools = {
    "SYSTEM_DIAGNOSTIC": () => {
        // Simulating a real system check
        const integrity = Math.floor(Math.random() * (100 - 80) + 80); // 80-99%
        const activeThreats = integrity < 90 ? 1 : 0;
        return JSON.stringify({
            status: "ONLINE",
            integrity_score: `${integrity}%`,
            active_threats: activeThreats,
            drift_detected: false,
            timestamp: new Date().toISOString()
        });
    }
};

// --- 1. Retrieval ---
async function findBestContext(query) {
    try {
        const queryRes = await axios.post('http://127.0.0.1:3000', { text: query });
        const queryVec = queryRes.data.sample;
        const memories = await getAllMemories();
        let best = { text: "", score: -1 };

        for (const mem of memories) {
            const docVec = mem.vector;
            const dot = queryVec.reduce((acc, val, i) => acc + val * docVec[i], 0);
            const magA = Math.sqrt(queryVec.reduce((acc, val) => acc + val * val, 0));
            const magB = Math.sqrt(docVec.reduce((acc, val) => acc + val * val, 0));
            const score = dot / (magA * magB);
            if (score > best.score) best = { text: mem.text, score };
        }
        return best;
    } catch (e) { return null; }
}

// --- 2. Generation & Tooling Loop ---
async function agentBrain(query, contextText) {
    let conversationHistory = `
    You are a Security Defense Agent.
    
    MEMORY CONTEXT: "${contextText}"
    USER QUESTION: "${query}"
    
    TOOLS AVAILABLE:
    - SYSTEM_DIAGNOSTIC: Returns current server integrity and threat status.
    
    INSTRUCTIONS:
    - If you can answer from MEMORY, just answer.
    - If you need to check the live system status, output exactly: [TOOL_CALL: SYSTEM_DIAGNOSTIC]
    - Do not hallucinate system status. Use the tool.
    `;

    // First Pass: Ask the LLM what it wants to do
    let result = await model.generateContent(conversationHistory);
    let response = result.response.text().trim();

    // Check if it wants to use a tool
    if (response.includes("[TOOL_CALL: SYSTEM_DIAGNOSTIC]")) {
        console.log("⚙️  Agent is using a tool: SYSTEM_DIAGNOSTIC...");
        
        // 1. Run the Tool
        const toolOutput = tools["SYSTEM_DIAGNOSTIC"]();
        console.log(`🔌 Tool Output: ${toolOutput}`);

        // 2. Feed the result back to the LLM
        const secondPrompt = `
        ${conversationHistory}
        
        SYSTEM_DIAGNOSTIC RESULT: ${toolOutput}
        
        Based on this result, answer the user's question concisely.
        `;

        const step2 = await model.generateContent(secondPrompt);
        return step2.response.text();
    }

    return response;
}

// --- 3. Learning ---
async function learnFact(text) {
    try {
        process.stdout.write("💾 Memorizing...");
        const res = await axios.post('http://127.0.0.1:3000', { text });
        await addMemory(text, res.data.sample);
        process.stdout.write("\r");
        console.log(`✅ Learned: "${text.substring(0, 40)}..."`);
    } catch (e) { console.log(`❌ Failed: ${e.message}`); }
}

// --- Main Loop ---
console.log("🤖 DEFENSE AGENT ONLINE. (Tools Active)");
console.log("   /learn <fact>   |   <question>");

const ask = () => {
    rl.question('\n👉 Command: ', async (input) => {
        if (input.startsWith('/learn ')) {
            await learnFact(input.replace('/learn ', ''));
        } else {
            console.log("🔍 Searching memory...");
            const context = await findBestContext(input);
            const contextText = (context && context.score > 0.65) ? context.text : "No relevant memory.";
            
            if (contextText !== "No relevant memory.") {
                 console.log(`💡 Memory Found: ${(context.score * 100).toFixed(0)}% match`);
            }

            process.stdout.write("🧠 Thinking...");
            const answer = await agentBrain(input, contextText);
            process.stdout.write("\r");
            
            console.log("\n💬 AI RESPONSE:");
            console.log(answer.trim());
        }
        ask();
    });
};

ask();
