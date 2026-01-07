# Gemini Bridge Operational Test

## Overview

This test validates the communication bridge between the Claude Code environment and the Gemini 2.0 Flash worker through the Polyglot Manager architecture.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Polyglot Manager                          │
│                  (Platform Router)                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐          ┌──────────────────┐        │
│  │  Primary Path   │          │  Secondary Path  │        │
│  │  (Cloud/Spaces) │          │  (Mac/Local)     │        │
│  ├─────────────────┤          ├──────────────────┤        │
│  │  Gemini 2.0     │          │  Ollama          │        │
│  │  Flash          │          │  (via PAL)       │        │
│  └─────────────────┘          └──────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Test Components

### 1. `test-gemini-bridge.js`
- Node.js test script using Google Generative AI SDK
- Sends "Bridge Operational" message to Gemini 2.0 Flash
- Validates response and confirms communication

### 2. `test-gemini-bridge.sh`
- Bash wrapper script
- Checks prerequisites (Node.js, dependencies, API key)
- Executes the test and reports results

## Setup Instructions

### Step 1: Get Gemini API Key

1. Visit: https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Create a new API key
4. Copy the key

### Step 2: Set Environment Variable

```bash
export GEMINI_API_KEY='your-api-key-here'
```

For persistent access, add to your shell profile:

```bash
echo 'export GEMINI_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

### Step 3: Run the Test

```bash
# Using the wrapper script (recommended)
./scripts/test-gemini-bridge.sh

# Or directly with Node.js
node ./scripts/test-gemini-bridge.js
```

## Expected Output

```
╔════════════════════════════════════════════════════════════╗
║           Gemini Bridge Operational Test                  ║
║         Polyglot Manager Communication Validator          ║
╚════════════════════════════════════════════════════════════╝

🚀 Launching Gemini Bridge Test...

=== Gemini Bridge Test ===

📡 Initializing Gemini 2.0 Flash connection...
📤 Sending message: "Bridge Operational"

✅ SUCCESS: Message sent and response received!

=== Gemini Response ===
[Gemini will respond acknowledging the message]
======================

✅ Bridge Operational - Communication confirmed

=== Test Summary ===
{
  "success": true,
  "message": "Bridge Operational",
  "response": "[Gemini's response]",
  "timestamp": "2026-01-06T..."
}
```

## Troubleshooting

### Error: No API Key Found

**Problem**: `GEMINI_API_KEY` or `GOOGLE_API_KEY` not set

**Solution**:
```bash
export GEMINI_API_KEY='your-api-key-here'
```

### Error: API Key Invalid

**Problem**: The API key is incorrect or has been revoked

**Solution**:
1. Verify your API key at https://aistudio.google.com/app/apikey
2. Generate a new key if needed
3. Update the environment variable

### Error: Model Not Found

**Problem**: The model name might have changed

**Solution**:
Check available models at Google AI Studio and update the model name in `test-gemini-bridge.js`:
```javascript
model: 'gemini-2.0-flash-exp'  // Update this if needed
```

### Error: Rate Limit Exceeded

**Problem**: Too many requests to the API

**Solution**:
- Wait a few minutes before retrying
- Check your API quota at Google AI Studio

### Error: Node.js Not Found

**Problem**: Node.js is not installed

**Solution**:
```bash
# On Codespaces (Debian/Ubuntu)
sudo apt-get update && sudo apt-get install -y nodejs npm

# On macOS
brew install node
```

## Platform Strategy

According to the AgentDB Constitution (CLAUDE.md):

- **Primary Platform**: Cloud (Codespaces) → Gemini 2.0 Flash
- **Secondary Platform**: Mac (Local) → Ollama (via PAL Manager)

This test validates the primary platform communication path.

## Integration with Skills

This test is part of the mandatory testing protocol mentioned in the project constitution:

- **Architecture**: Uses OpenSpec (os) skill
- **Testing**: Uses Agentic QE (aqe) skill
- **Security**: Runs drift-check.sh before commits

## Test Message Protocol

The test sends the specific message: **"Bridge Operational"**

This confirms:
1. ✅ Connection to Gemini API established
2. ✅ Authentication successful
3. ✅ Message routing working
4. ✅ Response received and parsed
5. ✅ Bridge is operational

## Files Created

```
scripts/
├── test-gemini-bridge.js      # Node.js test implementation
├── test-gemini-bridge.sh      # Bash wrapper script
└── GEMINI_BRIDGE_TEST.md      # This documentation
```

## Next Steps

After confirming the bridge is operational:

1. ✅ Verify Gemini receives "Bridge Operational"
2. ✅ Confirm message routing works correctly
3. Integrate with OpenSpec (os) skill
4. Integrate with Agentic QE (aqe) skill
5. Implement Polyglot Manager routing logic
6. Add Ollama support for Mac/Local platform

## Version Information

- **Test Version**: 1.0.0
- **Gemini Model**: gemini-2.0-flash-exp
- **SDK**: @google/generative-ai ^0.24.1
- **Platform**: Cloud (Codespaces)
- **Date**: 2026-01-06

## License

Part of the AgentDB Rust Prime project - see LICENSE for details.
