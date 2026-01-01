const axios = require('axios');
const readline = require('readline');

// The Knowledge Base
const documents = [
    "The sky is usually blue during the day.",
    "Apples are typically red or green fruits.",
    "Rust is a high-performance systems programming language.",
    "Dogs are loyal animals often kept as pets.",
    "Python is great for data science but slower than compiled languages.",
    "Docker containers package code and dependencies together."
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function findBestMatch(query) {
    try {
        console.log(`\n🧠 Thinking about: "${query}"...`);

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

        console.log(`\n🏆 ANSWER: ${best.text}`);
        console.log(`   (Confidence: ${(best.score * 100).toFixed(1)}%)`);
        console.log("-----------------------------------");

    } catch (e) {
        console.log("❌ Error: Brain not responding.");
    }
}

// Start the Chat Loop
console.log("🤖 MEMORY AGENT READY. (Press Ctrl+C to quit)");
console.log("I know about: Rust, Python, Docker, Apples, Dogs, and the Sky.");

const ask = () => {
    rl.question('\n❓ Ask me a question: ', async (question) => {
        await findBestMatch(question);
        ask(); // Ask again!
    });
};

ask();
