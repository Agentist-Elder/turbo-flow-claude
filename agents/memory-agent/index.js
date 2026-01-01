const axios = require('axios');
const readline = require('readline');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getAllMemories } = require('./db'); // <--- IMPORT THE DATABASE

// --- CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 1. Retrieval (Now powered by SQLite) ---
async function findBestContext(query) {
    try {
        // A. Vectorize the Question (We still need Rust for this live input)
        const queryRes = await axios.post('http://127.0.0.1:3000', { text: query });
        const queryVec = queryRes.data.sample;

        // B. Get Memories from Disk (Vectors are already pre-calculated!)
        const memories = await getAllMemories();

        let best = { text: "", score: -1 };

        // C. Compare (Math only, no network calls!)
        for (const mem of memories) {
            const docVec = mem.vector;

            // Cosine Similarity
            const dot = queryVec.reduce((acc, val, i) => acc + val * docVec[i], 0);
            const magA = Math.sqrt(queryVec.reduce((acc, val) => acc + val * val, 0));
            const magB = Math.sqrt(docVec.reduce((acc, val) => acc + val * val, 0));
            const score = dot / (magA * magB);

            if (score > best.score) best = { text: mem.text, score };
        }
        return best;
    } catch (e) {
        console.error("❌ System Error:", e.message);
        return null;
    }
}

// --- 2. Generation (Gemini) ---
async function generateAnswer(query, context) {
    const prompt = `
    You are a helpful AI Assistant.
    CONTEXT: "${context.text}"
    QUESTION: "${query}"
    ANSWER (concise):`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (e) {
         return `❌ Gemini Error: ${e.message}`;
    }
}

// --- Main Loop ---
console.log("🤖 AGENT DB READY. (Powered by SQLite)");
console.log("Using Model: gemini-2.0-flash");

const ask = () => {
    rl.question('\n❓ Ask me: ', async (question) => {
        console.log("🔍 Scanning SQLite Database..."); // <--- Proof it's using DB
        const context = await findBestContext(question);

        if (context && context.score > 0.65) {
            console.log(`💡 Found Memory (${(context.score * 100).toFixed(0)}% match)`);
            process.stdout.write("🧠 Thinking...");

            const answer = await generateAnswer(question, context);

            process.stdout.write("\r");
            console.log("\n💬 AI RESPONSE:");
            console.log(answer.trim());
        } else {
            console.log("🤷 I don't recall anything about that.");
        }

        ask();
    });
};

ask();
