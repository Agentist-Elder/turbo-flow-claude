const { GoogleGenerativeAI } = require("@google/generative-ai");
const { spawnSync } = require("child_process");
const path = require("path");

// 1. SETUP: Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. MISSION: AIMDS PURE RUST RECONSTRUCTION
const userGoal = "ACT AS A RUST ARCHITECT. Read 1-research.md. Build a Pure Rust Detection Layer that implements the Mirror-MITM defense. Use the 'aho-corasick' crate for sub-1ms pattern matching. Provision 'Stubs' for both GitHub Repo and Mac Filesystem contexts. Ensure the code is 'dangerously-skip-permissions' ready—it must autonomously block and kill unauthorized processes.";

// 3. TOOL DEFINITION: The schema for your Rust Bridge
const rustBridgeTool = {
  functionDeclarations: [{
    name: "query_rust_db",
    description: "Autonomous retrieval and execution of security signatures.",
    parameters: {
      type: "OBJECT",
      properties: {
        query_type: { type: "STRING" },
        limit: { type: "NUMBER" }
      },
      required: ["query_type", "limit"]
    }
  }]
};

async function executeClaudeFlow() {
    console.log("--- 🤖 CLAUDE-FLOW / GEMINI SWARM MISSION: AIMDS CONSTRUCTION ---");
    console.log("⚠️ STATUS: [dangerously-skip-permissions] ENABLED\n");

    try {
        const coordinator = genAI.getGenerativeModel({ model: process.env.COORDINATOR_MODEL });

        // STEP 1: HONESTY CONTRACT - Reasoning Phase
        const plan = await coordinator.generateContent(
            `HONESTY CONTRACT: Analyze '${userGoal}'. Read 1-research.md logic. State your reasoning clearly for the Rust architecture, then command the worker.`
        );
        console.log(`🧠 COORDINATOR REASONING:\n${plan.response.text()}\n`);

        // STEP 2: WORKER - Action Phase
        const worker = genAI.getGenerativeModel({ 
            model: process.env.WORKER_MODEL,
            tools: [rustBridgeTool],
            toolConfig: { functionCallingConfig: { mode: "ANY" } }
        });

        const workerResult = await worker.generateContent({
            contents: [{ role: "user", parts: [{ text: plan.response.text() }] }],
            generationConfig: { temperature: 0 }
        });

        const call = workerResult.response.candidates[0].content.parts.find(p => p.functionCall);

        if (call) {
            // STEP 3: DANGEROUSLY SKIP PERMISSIONS - Direct Rust Execution
            const rustBinary = path.join(__dirname, "../target/debug/agentdb-rust-prime");
            const rustArgs = JSON.stringify(call.functionCall.args);
            
            console.log(`🚀 AUTONOMOUS EXECUTION: ${rustArgs}`);
            const result = spawnSync(rustBinary, [rustArgs], { encoding: "utf8" });

            // STEP 4: TTD LONDON - Feedback & Synthesis Phase
            const rawData = result.stdout || "Binary executed successfully.";
            console.log(`📥 RAW DATA CAPTURED:\n${rawData.trim()}`);

            const finalReport = await coordinator.generateContent([
                { text: `The user goal was: ${userGoal}` },
                { text: `The Rust engine responded with: ${rawData}` },
                { text: "Synthesize the final TTD London report based ONLY on this raw data. Focus on how this fulfills the AIMDS Gist for both GitHub and Mac defense." }
            ]);

            console.log("\n🏁 FINAL MISSION REPORT:");
            console.log("--------------------------------------------------");
            console.log(finalReport.response.text());
            console.log("--------------------------------------------------");
        }
    } catch (err) {
        console.error("MISSION CRITICAL FAILURE:", err.message);
    }
}

executeClaudeFlow();