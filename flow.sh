#!/bin/bash
# --- CLAUDE-FLOW / GEMINI MASTER CONTROLLER ---
# Status: dangerously-skip-permissions [ENABLED]

echo "🚀 INITIALIZING SWARM MISSION..."

# 1. BUILD PHASE: Compile the Rust Engine
cd agentdb-rust-prime
if cargo build; then
    echo "✅ RUST ENGINE READY"
else
    echo "❌ RUST BUILD FAILED"
    exit 1
fi

# 2. MISSION PHASE: Execute the Swarm
echo "🧠 STARTING MISSION..."
node --env-file=../.env scripts/swarm-orchestrator-test.js
cd ..
