require('dotenv').config({ path: '../../.env' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

// --- IMPORT SUB-AGENTS ---
const MemoryAgent = require('../memory-agent/api');
const CoderAgent = require('../coder-agent/api');
const ResearcherAgent = require('../researcher-agent/api'); // NEW!

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

console.log("🐝 SWARM DISPATCHER ONLINE.");
console.log("   Orchestrating: [Memory] + [Coder] + [Researcher]");

async function swarmRouter(userInput) {
    console.log(`\n📨 USER: "${userInput}"`);

    // 1. ROUTING PROMPT
    const prompt = `
    SYSTEM: You are the Swarm Orchestrator.
    
    AGENTS:
    1. [MEMORY]: 'LEARN' (save fact) or 'RECALL' (search history).
    2. [CODER]: 'LIST', 'READ', or 'WRITE' files.
    3. [RESEARCHER]: 'SEARCH' the live web for new information.

    USER INPUT: "${userInput}"

    INSTRUCTIONS:
    Output strictly JSON.
    Example: {"agent": "RESEARCHER", "task": "SEARCH", "input": "Latest cybersecurity threats 2026"}
    `;

    try {
        const result = await model.generateContent(prompt);
        let text = result.response.text().replace(/```json|```/g, "").trim();
        if (text.startsWith("```")) text = text.replace(/```/g, "");

        let cmd;
        try { 
            cmd = JSON.parse(text); 
        } catch (e) { 
            console.error("   ❌ JSON Parse Error:", text); 
            return; 
        }

        console.log(`   👉 DELEGATING TO: [${cmd.agent}] -> ${cmd.task}`);

        // 2. ROUTING LOGIC
        let output;
        
        if (cmd.agent === "MEMORY") {
            output = await MemoryAgent.handle(cmd.task, cmd.input);
        } 
        else if (cmd.agent === "CODER") {
            output = await CoderAgent.handle(cmd.task, cmd.input);
        }
        else if (cmd.agent === "RESEARCHER") {
            output = await ResearcherAgent.handle(cmd.task, cmd.input);
        }
        else {
            output = "Error: Unknown Agent";
        }

        // 3. SYNTHESIS
        console.log("   ✅ Agent Finished.");
        
        // Safety: truncate long outputs for the console (keep full data in memory)
        const displayOutput = typeof output === 'string' && output.length > 500 
            ? output.substring(0, 500) + "\n... [truncated]" 
            : output;
            
        console.log(`   📤 Result: ${JSON.stringify(displayOutput, null, 2)}`);

    } catch (e) {
        console.error("   ❌ Swarm Error:", e.message);
    }
}

// --- CLI LOOP ---
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.setPrompt('🐝 Command: ');
rl.prompt();

rl.on('line', async (line) => {
    if (line.trim()) await swarmRouter(line.trim());
    rl.prompt();
});
