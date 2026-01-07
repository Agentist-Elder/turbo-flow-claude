# Gemini 2.0 Flash Bridge Test

## Mission Overview
**SwarmLead Coordinator Test**: Verify connection with Gemini 2.0 Flash through Polyglot Manager

### Test Configuration
- **Manager**: Polyglot
- **Worker**: gemini-1.5-flash
- **Task**: Output 'Bridge Operational'
- **Goal**: Verify Gemini receives and responds to signals

---

## Quick Start

### 1. Prerequisites
- Node.js installed (✓ Available: v24.12.0)
- Google Generative AI package (✓ Installed: @google/generative-ai)
- Gemini API key

### 2. Get API Key
Visit: https://aistudio.google.com/app/apikey

### 3. Set Environment Variable
```bash
export GEMINI_API_KEY="your-api-key-here"
```

### 4. Run Test
```bash
node scripts/gemini-bridge-test.js
```

Or with inline API key:
```bash
GEMINI_API_KEY="your-key" node scripts/gemini-bridge-test.js
```

---

## Expected Output

### Success Case
```
╔════════════════════════════════════════════╗
║  Gemini 2.0 Flash Bridge Test             ║
║  SwarmLead Coordinator                     ║
╚════════════════════════════════════════════╝

[Test Configuration]
  Manager: Polyglot
  Worker:  gemini-1.5-flash
  Task:    Output 'Bridge Operational'

[SwarmLead] Initiating connection test...

[Polyglot Manager] Routing task to worker: gemini-1.5-flash
[Worker Response Received]
Response: Bridge Operational
Latency: XXXms

╔════════════════════════════════════════════╗
║  Test Results                              ║
╚════════════════════════════════════════════╝

✓ SUCCESS: Bridge is operational!
✓ Gemini worker responded with expected phrase
✓ Connection verified
✓ Polyglot Manager routing functional

[Mission Status] COMPLETE
[Signal Received] Bridge Operational
```

---

## Troubleshooting

### Error: GEMINI_API_KEY not set
**Solution**: Export the environment variable before running
```bash
export GEMINI_API_KEY="your-api-key"
```

### Error: API key invalid
**Solution**:
1. Verify key at https://aistudio.google.com/app/apikey
2. Ensure no extra spaces in the key
3. Try regenerating the key

### Error: Network issues
**Solution**:
- Check internet connection
- Verify firewall/proxy settings
- Try with different network

---

## Architecture

### Polyglot Manager Pattern
```
┌─────────────────────────────────────────┐
│          SwarmLead Coordinator          │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │      Polyglot Manager             │  │
│  │                                   │  │
│  │  Route Task                       │  │
│  │      ↓                            │  │
│  │  ┌──────────────────────────┐    │  │
│  │  │  Gemini 1.5 Flash        │    │  │
│  │  │  (Worker)                │    │  │
│  │  │                          │    │  │
│  │  │  Task: "Bridge Test"     │    │  │
│  │  │  Response: "Bridge       │    │  │
│  │  │            Operational"  │    │  │
│  │  └──────────────────────────┘    │  │
│  │      ↓                            │  │
│  │  Verify Response                  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  Status: SUCCESS ✓                      │
└─────────────────────────────────────────┘
```

---

## Integration with AgentDB Project

### Platform Strategy (Per CLAUDE.md)
- **Primary**: Cloud (Codespaces) → Gemini 2.0 Flash
- **Secondary**: Mac (Local) → Ollama (via PAL Manager)

### Test Validates
1. ✓ Polyglot Manager routing functional
2. ✓ Gemini API connectivity
3. ✓ Worker response accuracy
4. ✓ SwarmLead coordination pattern
5. ✓ Cloud platform readiness

---

## Next Steps

After successful bridge test:
1. Integrate with AgentDB architecture
2. Connect to OpenSpec (`os`) skill
3. Connect to Agentic QE (`aqe`) skill
4. Run drift-check.sh before commits
5. Follow 1-research.md mission specifications

---

## Files

- **Test Script**: `/workspaces/turbo-flow-claude/agentdb-rust-prime/scripts/gemini-bridge-test.js`
- **Dependencies**: `/workspaces/turbo-flow-claude/agentdb-rust-prime/package.json`
- **Project Config**: `/workspaces/turbo-flow-claude/agentdb-rust-prime/CLAUDE.md`
- **Research Plan**: `/workspaces/turbo-flow-claude/agentdb-rust-prime/1-research.md`

---

## Support

For issues:
1. Verify Node.js: `node --version`
2. Verify package: `npm list @google/generative-ai`
3. Check API key: `echo $GEMINI_API_KEY | wc -c` (should be >10)
4. Test network: `curl https://generativelanguage.googleapis.com/`

---

**Version**: 1.0
**Date**: 2026-01-06
**Mission**: SwarmLead Bridge Test
**Status**: Ready for Execution
