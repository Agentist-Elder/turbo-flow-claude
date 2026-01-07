#!/bin/bash
# test-gemini-bridge.sh: Wrapper script for Gemini Bridge Test
# Part of the Polyglot Manager architecture

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║           Gemini Bridge Operational Test                  ║"
echo "║         Polyglot Manager Communication Validator          ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ ERROR: Node.js is not installed"
    echo "Please install Node.js to run this test"
    exit 1
fi

# Check for dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ ! -d "$PROJECT_ROOT/node_modules/@google/generative-ai" ]; then
    echo "📦 Installing dependencies..."
    cd "$PROJECT_ROOT"
    npm install
    echo ""
fi

# Check for API key
if [ -z "$GEMINI_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ]; then
    echo "❌ ERROR: No API key found"
    echo ""
    echo "To run this test, you need a Gemini API key."
    echo ""
    echo "Setup instructions:"
    echo "1. Get an API key from: https://aistudio.google.com/app/apikey"
    echo "2. Export it as an environment variable:"
    echo ""
    echo "   export GEMINI_API_KEY='your-api-key-here'"
    echo ""
    echo "3. Run this script again"
    echo ""
    exit 1
fi

# Run the test
echo "🚀 Launching Gemini Bridge Test..."
echo ""

cd "$SCRIPT_DIR"
node test-gemini-bridge.js

exit $?
