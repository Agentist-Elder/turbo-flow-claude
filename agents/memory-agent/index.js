const axios = require('axios');
const readline = require('readline');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { addMemory, getAllMemories } = require('./db');

// --- CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 🛠️ TOOLS ---
const tools = {
    "SYSTEM_DIAGNOSTIC": () => {
        const integrity = Math.floor(Math.random() * (100 - 80) + 80);
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

// --- HELPER: Memorize ---
async function memorize(text) {
    try {
        const res = await axios.post('http://127.0.0.1:3000', { text });
        const vector = res.data.sample;
        await addMemory(text, vector);
        console.log(`   💾 Logged to Memory: "${text.substring(0, 40)}..."`);
    } catch (e) {
        console.error("   ❌ Memory Write Failed");
    }
}

// --- 1. Retrieval (Time-Aware Recency Boost) ---
async function findBestContext(query) {
    try {
        const queryRes = await axios.post('http://127.0.0.1:3000', { text: query });
        const queryVec = queryRes.data.sample;
        const memories = await getAllMemories();
        
        const now = new Date(); // Current UTC time in Node

        let scoredMemories = memories.map(mem => {
            const docVec = mem.vector;
            
            // A. Base Vector Similarity
            const dot = queryVec.reduce((acc, val, i) => acc + val * docVec[i], 0);
            const magA = Math.sqrt(queryVec.reduce((acc, val) => acc + val * val, 0));
            const magB = Math.sqrt(docVec.reduce((acc, val) => acc + val * val, 0));
            let score = dot / (magA * magB);

            // B. Recency Boost (FIXED TIMEZONE LOGIC)
            if (mem.created_at) {
                // SQLite returns "YYYY-MM-DD HH:MM:SS".
                // We replace the space with 'T' and add 'Z' to force JavaScript to treat it as UTC.
                const cleanTime = mem.created_at.replace(' ', 'T') + 'Z';
                const memTime = new Date(cleanTime);
                
                // Calculate difference in minutes
                const diffMins = (now.getTime() - memTime.getTime()) / 60000;

                // Boost if newer than 5 minutes (allowing small clock skew)
                if (diffMins < 5 && diffMins >= -1) {
                    score += 0.5; // HUGE Boost
                    mem.text = `[JUST NOW] ${mem.text}`;
                }
            }

            return { text: mem.text, score: score };
        });

        // Sort High to Low and take Top 3
        scoredMemories.sort((a, b) => b.score - a.score);
        const top3 = scoredMemories.slice(0, 3);

        return {
            text: top3.map(m => `- ${m.text} (Score: ${(m.score*100).toFixed(0)}%)`).join("\n"),
            score: top3[0] ? top3[0].score : 0 
        };
    } catch (e) { return null; }
}

// --- 2. Generation & Tooling Loop ---
async function agentBrain(query, contextText) {
    let conversationHistory = `
    You are an Autonomous Security Droid.
    
    MEMORY CONTEXT (Top 3 Matches):
    ${contextText}
    
    USER INPUT: "${query}"
    
    PROTOCOL:
    1. COMMANDS: If user implies "run scan" or "check system", YOU MUST EXECUTE THE TOOL. Output: [TOOL_CALL: SYSTEM_DIAGNOSTIC]
    2. SHORT-TERM MEMORY: If the MEMORY CONTEXT contains entries marked [JUST NOW], these are the most important facts. Use them to answer questions about "recent" or "last" events.
    3. DO NOT ASK FOR PERMISSION. ACT.
    `;

    let result = await model.generateContent(conversationHistory);
    let response = result.response.text().trim();

    // --- SAFETY NET ---
    const intent = query.toLowerCase();
    if (!response.includes("[TOOL_CALL") && (intent.includes("run scan") || intent.includes("system check"))) {
         console.log("⚠️  (Override) Forcing Tool Execution...");
         response = "[TOOL_CALL: SYSTEM_DIAGNOSTIC]";
    }

    // --- EXECUTION BLOCK ---
    if (response.includes("[TOOL_CALL: SYSTEM_DIAGNOSTIC]")) {
        console.log("⚙️  Running Live Diagnostic...");
        
        const toolOutput = tools["SYSTEM_DIAGNOSTIC"]();
        console.log(`🔌 Output: ${toolOutput}`);

        const logEntry = `[SYSTEM_LOG] Diagnostic ran at ${new Date().toISOString()}. Result: ${toolOutput}`;
        await memorize(logEntry); 

        const secondPrompt = `
        USER INPUT: "${query}"
        SYSTEM_DIAGNOSTIC RESULT: ${toolOutput}
        INSTRUCTION: State the system status clearly.
        `;

        const step2 = await model.generateContent(secondPrompt);
        return step2.response.text().trim();
    }

    return response;
}

// --- Main Loop ---
console.log("🤖 DEFENSE AGENT ONLINE. (UTC Recency Fix Applied)");
console.log("   /learn <fact>   |   <question>");

const ask = () => {
    rl.question('\n👉 Command: ', async (input) => {
        if (input.startsWith('/learn ')) {
            const fact = input.replace('/learn ', '');
            await memorize(fact);
            console.log("✅ Learned.");
        } else {
            console.log("🔍 Searching memory...");
            const context = await findBestContext(input);
            const contextText = (context && context.score > 0.65) ? context.text : "No relevant memory.";
            
            if (contextText !== "No relevant memory.") {
                 console.log(`💡 Memories Found:\n${contextText}`);
            }

            process.stdout.write("🧠 Thinking...");
            const answer = await agentBrain(input, contextText);
            process.stdout.write("\r");
            
            console.log("\n💬 AI RESPONSE:");
            console.log(answer);
        }
        ask();
    });
};

ask();
