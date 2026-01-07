#!/usr/bin/env node

/**
 * Gemini 2.0 Flash Bridge Test
 * Mission: Test connection with Gemini worker through Polyglot Manager
 * SwarmLead Coordinator Test Script
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m'
};

class PolyglotManager {
  constructor(apiKey) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.workerModel = process.env.CLAUDE_FLOW_MODEL || 'gemini-2.0-flash'; // Worker model as specified in mission
  }

  /**
   * Route request to Gemini worker
   * @param {string} task - The task to send to the worker
   * @returns {Promise<string>} - Worker response
   */
  async routeToWorker(task) {
    console.log(`${colors.cyan}[Polyglot Manager]${colors.reset} Routing task to worker: ${colors.yellow}${this.workerModel}${colors.reset}`);

    const model = this.genAI.getGenerativeModel({ model: this.workerModel });

    const result = await model.generateContent(task);
    const response = result.response;
    const text = response.text();

    return text;
  }

  /**
   * Test the bridge connection
   */
  async testBridge() {
    console.log(`${colors.bright}${colors.blue}╔════════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}║  Gemini 2.0 Flash Bridge Test             ║${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}║  SwarmLead Coordinator                     ║${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}╚════════════════════════════════════════════╝${colors.reset}\n`);

    console.log(`${colors.cyan}[Test Configuration]${colors.reset}`);
    console.log(`  Manager: Polyglot`);
    console.log(`  Worker:  ${this.workerModel}`);
    console.log(`  Task:    Output 'Bridge Operational'\n`);

    try {
      console.log(`${colors.yellow}[SwarmLead]${colors.reset} Initiating connection test...\n`);

      const testTask = "You are a worker in a swarm coordination test. Your task is to output exactly the text 'Bridge Operational' to confirm the connection is working. Output only that phrase, nothing else.";

      const startTime = Date.now();
      const response = await this.routeToWorker(testTask);
      const endTime = Date.now();
      const latency = endTime - startTime;

      console.log(`${colors.green}[Worker Response Received]${colors.reset}`);
      console.log(`${colors.bright}Response:${colors.reset} ${response.trim()}`);
      console.log(`${colors.cyan}Latency:${colors.reset} ${latency}ms\n`);

      // Verify the response
      const expectedPhrase = 'Bridge Operational';
      const responseContainsPhrase = response.includes(expectedPhrase);

      console.log(`${colors.bright}${colors.blue}╔════════════════════════════════════════════╗${colors.reset}`);
      console.log(`${colors.bright}${colors.blue}║  Test Results                              ║${colors.reset}`);
      console.log(`${colors.bright}${colors.blue}╚════════════════════════════════════════════╝${colors.reset}\n`);

      if (responseContainsPhrase) {
        console.log(`${colors.green}${colors.bright}✓ SUCCESS:${colors.reset} Bridge is operational!`);
        console.log(`${colors.green}✓${colors.reset} Gemini worker responded with expected phrase`);
        console.log(`${colors.green}✓${colors.reset} Connection verified`);
        console.log(`${colors.green}✓${colors.reset} Polyglot Manager routing functional\n`);

        console.log(`${colors.cyan}[Mission Status]${colors.reset} ${colors.green}COMPLETE${colors.reset}`);
        console.log(`${colors.cyan}[Signal Received]${colors.reset} ${colors.green}${expectedPhrase}${colors.reset}`);

        return {
          success: true,
          message: 'Bridge Operational',
          latency: latency,
          worker: this.workerModel
        };
      } else {
        console.log(`${colors.yellow}⚠ PARTIAL SUCCESS:${colors.reset} Connection established but response differs`);
        console.log(`${colors.yellow}⚠${colors.reset} Expected: "${expectedPhrase}"`);
        console.log(`${colors.yellow}⚠${colors.reset} Received: "${response.trim()}"\n`);

        return {
          success: false,
          message: 'Connection OK but response varies',
          latency: latency,
          worker: this.workerModel,
          actualResponse: response.trim()
        };
      }

    } catch (error) {
      console.log(`${colors.red}${colors.bright}✗ FAILURE:${colors.reset} Bridge test failed\n`);
      console.log(`${colors.red}Error:${colors.reset} ${error.message}\n`);

      if (error.message.includes('API key')) {
        console.log(`${colors.yellow}Hint:${colors.reset} Set GEMINI_API_KEY environment variable`);
        console.log(`${colors.yellow}Example:${colors.reset} export GEMINI_API_KEY="your-api-key-here"`);
      }

      console.log(`${colors.cyan}[Mission Status]${colors.reset} ${colors.red}FAILED${colors.reset}`);

      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Main execution
async function main() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.log(`${colors.red}${colors.bright}ERROR:${colors.reset} GEMINI_API_KEY environment variable not set\n`);
    console.log(`${colors.yellow}Setup Instructions:${colors.reset}`);
    console.log(`  1. Get API key from: https://aistudio.google.com/app/apikey`);
    console.log(`  2. Set environment variable: export GEMINI_API_KEY="your-key"`);
    console.log(`  3. Run test again: node scripts/gemini-bridge-test.js\n`);
    process.exit(1);
  }

  const manager = new PolyglotManager(apiKey);
  const result = await manager.testBridge();

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { PolyglotManager };
