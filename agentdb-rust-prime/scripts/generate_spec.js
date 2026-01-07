const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");

// Configuration: Maximum persistence
const MAX_RETRIES = 5;
const INITIAL_DELAY_MS = 2000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEN_AI_KEY;
  if (!key) { console.error("❌ No API Key found."); process.exit(1); }

  console.log("🔋 Powering up Gemini 2.5 Flash...");
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  if (!fs.existsSync("1-research.md")) {
    console.error("❌ Missing 1-research.md"); 
    process.exit(1);
  }
  const context = fs.readFileSync("1-research.md", "utf8");

  const prompt = `
  ROLE: System Architect.
  TASK: Convert the Research Context into a technical Architecture Spec.
  OUTPUT: Write valid Markdown for 'architecture_spec.md'.
  
  REQUIREMENTS:
  - Define AgentDB Schema (Rust).
  - Define Security Isolation (Mac/Docker).
  - Define Drift Check Strategy.
  
  RESEARCH CONTEXT:
  ${context}
  `;

  console.log("🚀 Sending to Orbit (Attempting connection)...");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      fs.writeFileSync("architecture_spec.md", text);
      console.log("✅ MISSION SUCCESS: architecture_spec.md created.");
      return; // Exit on success
    } catch (e) {
      const isOverloaded = e.message.includes("503") || e.message.includes("overloaded");
      if (isOverloaded && attempt < MAX_RETRIES) {
        const delay = INITIAL_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`⚠️  Google is busy (503). Retrying in ${delay/1000}s... (Attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delay);
      } else {
        console.error("❌ Fatal Error:", e.message);
        process.exit(1);
      }
    }
  }
}

run();
