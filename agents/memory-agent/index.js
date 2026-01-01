const axios = require('axios');
const readline = require('readline');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { addMemory, getAllMemories } = require('./db'); // <--- Import Write Access

// --- CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// --- 1. Retrieval ---
async function findBestContext(query) {
    try {
        const queryRes = await axios.post('http://127.0.0.1:3000', { text: query });
        const queryVec = queryRes.data.sample;
        const memories = await getAllMemories(); // Reload memories every time to catch new ones
        
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
    } catch (e) {
        return null;
    }
}

// --- 2. Generation ---
async function generateAnswer(query, context) {
    const prompt = `
    You are a helpful AI Assistant.
    CONTEXT: "${context.text}"
    QUESTION: "${query}"
    ANSWER (concise):`;
    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (e) { return "Error generating answer."; }
}

// --- 3. Learning (The New Part) ---
async function learnFact(text) {
    try {
        process.stdout.write("💾 Memorizing...");
        // Vectorize
        const res = await axios.post('http://127.0.0.1:3000', { text });
        const vector = res.data.sample;
        // Save to Disk
        await addMemory(text, vector);
        process.stdout.write("\r");
        console.log(`✅ Learned: "${text.substring(0, 40)}..."`);
    } catch (e) {
        console.log(`❌ Failed to learn: ${e.message}`);
    }
}

// --- Main Loop ---
console.log("🤖 AGENT ONLINE. Commands:");
console.log("   /learn <fact>  -> Teach me something new");
console.log("   <question>     -> Ask me something");

const ask = () => {
    rl.question('\n👉 Command: ', async (input) => {
        
        // A. Check if it's a Learning Command
        if (input.startsWith('/learn ')) {
            const fact = input.replace('/learn ', '');
            await learnFact(fact);
        } 
        // B. Standard Question
        else {
            console.log("🔍 Searching memory...");
            const context = await findBestContext(input);
            
            if (context && context.score > 0.65) {
                console.log(`💡 Found Memory (${(context.score * 100).toFixed(0)}% match)`);
                process.stdout.write("🧠 Thinking...");
                const answer = await generateAnswer(input, context);
                process.stdout.write("\r");
                console.log("\n💬 AI RESPONSE:");
                console.log(answer.trim());
            } else {
                console.log("🤷 I don't know that yet. Use /learn to teach me!");
            }
        }
        
        ask();
    });
};

ask();
