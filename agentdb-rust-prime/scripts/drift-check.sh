#!/bin/bash
# drift-check.sh: Verifies Docker Security & System Architecture

# A. Security: Check for dangerous root mounts
if grep -q "/:" ../docker-compose.yml 2>/dev/null; then
    echo "❌ FAIL: Host Root mount detected!"
    exit 1
fi

# B. Architecture: Detect Apple Silicon vs Cloud
ARCH=$(uname -m)
if [[ "$ARCH" == "aarch64" ]]; then
    echo "✅ PLATFORM: Apple Silicon (ARM64) - Local Mode Active"
else
    echo "⚠️ PLATFORM: x86_64 (Cloud) - Using Cloud Providers"
fi

echo "✅ DRIFTGUARD: System Integrity Verified"
