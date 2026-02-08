import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "dotenv";

config();

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) {
  console.error("GOOGLE_API_KEY is not set");
  process.exit(1);
}

const COORDINATOR_MODEL = process.env.COORDINATOR_MODEL || "gemini-3-flash-preview";
const WORKER_MODEL = process.env.WORKER_MODEL || "gemini-2.5-flash";

const genAI = new GoogleGenerativeAI(API_KEY);

async function testModel(role, modelName) {
  console.log(`\n--- Testing ${role}: ${modelName} ---`);
  try {
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(`Say "Hello from ${role}" in one sentence.`);
    const text = result.response.text();
    console.log(`Response: ${text.trim()}`);
    console.log(`Status: PASS`);
    return true;
  } catch (err) {
    console.error(`Status: FAIL — ${err.message}`);
    return false;
  }
}

async function main() {
  console.log("=== RuvBot Model Test ===");
  console.log(`Coordinator: ${COORDINATOR_MODEL}`);
  console.log(`Worker:      ${WORKER_MODEL}`);

  const coordOk = await testModel("Coordinator", COORDINATOR_MODEL);
  const workerOk = await testModel("Worker", WORKER_MODEL);

  console.log("\n=== Results ===");
  console.log(`Coordinator (${COORDINATOR_MODEL}): ${coordOk ? "PASS" : "FAIL"}`);
  console.log(`Worker      (${WORKER_MODEL}): ${workerOk ? "PASS" : "FAIL"}`);
  process.exit(coordOk && workerOk ? 0 : 1);
}

main();
