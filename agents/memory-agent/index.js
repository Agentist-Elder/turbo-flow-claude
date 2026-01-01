const axios = require('axios');
const readline = require('readline');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURATION ---
// Access the API Key
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Use the specific model name (removed 'gemini/' prefix if present)
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

// The Knowledge Base
const documents = [
    "The sky is usually blue during the day due to Rayleigh scattering.",
    "Apples are typically red or green fruits and are rich in fiber.",
    "Rust is a high-performance systems programming language that guarantees memory safety.",
    "Dogs are loyal animals often kept as pets and used for guarding.",
    "Python is great for data science but can be slower than compiled languages like Rust.",
    "Docker containers package code and dependencies together for consistent deployment."
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- Helper: Find the Best Fact ---
async function findBestContext(query) {
    try {
        // 1. Vectorize the Question
        const queryRes = await axios.post('http://127.0.0.1:3000', { text: query });
        const queryVec = queryRes.data.sample;
        let best = { text: "", score: -1 };

        // 2. Scan Memories
        for (const doc of documents) {
            const docRes = await axios.post('http://127.0.0.1:3000', { text: doc });
            const docVec = docRes.data.sample;
            
            // Cosine Similarity Math
            const dot = queryVec.reduce((acc, val, i) => acc + val * docVec[i], 0);
            const magA = Math.sqrt(queryVec.reduce((acc, val) => acc + val * val, 0));
            const magB = Math.sqrt(docVec.reduce((acc, val) => acc + val * val, 0));
            const score = dot / (magA * magB);

            if (score > best.score) best = { text: doc, score };
        }
        return best;
    } catch (e) {
        console.error("❌ Retrieval Error (Rust Engine):", e.message);
        return null;
    }
}

// --- Helper: Generate Answer with Gemini ---
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

// --- Main Chat Loop ---
console.log("🤖 GEN-AI AGENT READY. (Press Ctrl+C to quit)");
console.log("Using Model: gemini-2.0-flash");

const ask = () => {
    rl.question('\n❓ Ask me: ', async (question) => {
        console.log("🔍 Searching memory...");
        const context = await findBestContext(question);
        
        if (context && context.score > 0.65) {
            console.log(`💡 Found relevant fact (${(context.score * 100).toFixed(0)}% match)`);
            process.stdout.write("🧠 Thinking...");
            
            const answer = await generateAnswer(question, context);
            
            process.stdout.write("\r");
            console.log("\n💬 AI RESPONSE:");
            console.log(answer.trim());
        } else {
            console.log("🤷 I don't recall anything about that.");
        }
        
        ask(); // Ask again
    });
};

ask();
