#!/bin/bash
echo "🚀 Starting AIMDS Engine..."
cargo run --manifest-path agentdb-rust-prime/Cargo.toml > london_test.log 2>&1 &
PID=$!
echo "⏳ Engine PID: $PID. Warming up sensors (5s)..."
sleep 5
echo "⚔️  EXECUTING ATTACK: Generating High-Entropy Binary Payload..."
dd if=/dev/urandom of=agentdb-rust-prime/london_attack.bin bs=1024 count=1 2>/dev/null
sleep 2
kill $PID 2>/dev/null
rm agentdb-rust-prime/london_attack.bin 2>/dev/null
echo "--- 📊 LONDON TTD RESULTS ---"
grep "LONDON REPORT" london_test.log
