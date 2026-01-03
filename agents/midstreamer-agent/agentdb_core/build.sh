#!/bin/bash
#
# Build script for agentdb_core WASM module
#
# Prerequisites:
#   - Rust toolchain (rustup): https://rustup.rs/
#   - wasm-pack: cargo install wasm-pack
#   - Node.js 18+ (for testing)
#
# Usage:
#   ./build.sh           # Build for Node.js (default)
#   ./build.sh --web     # Build for browser
#   ./build.sh --test    # Run tests
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}AgentDB Core - WASM Build Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Check prerequisites
check_prerequisites() {
    echo -e "\n${YELLOW}Checking prerequisites...${NC}"

    if ! command -v rustc &> /dev/null; then
        echo -e "${RED}Error: Rust is not installed${NC}"
        echo "Install from: https://rustup.rs/"
        exit 1
    fi

    if ! command -v wasm-pack &> /dev/null; then
        echo -e "${RED}Error: wasm-pack is not installed${NC}"
        echo "Install with: cargo install wasm-pack"
        exit 1
    fi

    echo -e "${GREEN}✓ All prerequisites satisfied${NC}"
}

# Add wasm32 target if not present
add_wasm_target() {
    echo -e "\n${YELLOW}Ensuring wasm32-unknown-unknown target is installed...${NC}"
    rustup target add wasm32-unknown-unknown
}

# Build for Node.js
build_nodejs() {
    echo -e "\n${YELLOW}Building for Node.js...${NC}"

    wasm-pack build \
        --target nodejs \
        --out-dir pkg \
        --release \
        -- \
        --features console_error_panic_hook || true

    echo -e "${GREEN}✓ Build complete: pkg/ directory${NC}"
    echo -e "${GREEN}  - pkg/agentdb_core.js (Node.js module)${NC}"
    echo -e "${GREEN}  - pkg/agentdb_core_bg.wasm (WASM binary)${NC}"
    echo -e "${GREEN}  - pkg/agentdb_core.d.ts (TypeScript definitions)${NC}"
}

# Build for browser
build_web() {
    echo -e "\n${YELLOW}Building for browser...${NC}"

    wasm-pack build \
        --target web \
        --out-dir pkg-web \
        --release \
        -- \
        --features console_error_panic_hook || true

    echo -e "${GREEN}✓ Build complete: pkg-web/ directory${NC}"
}

# Run tests
run_tests() {
    echo -e "\n${YELLOW}Running Rust tests...${NC}"
    cargo test

    echo -e "\n${YELLOW}Running WASM tests...${NC}"
    wasm-pack test --node
}

# Display build info
show_info() {
    echo -e "\n${GREEN}========================================${NC}"
    echo -e "${GREEN}Build Information${NC}"
    echo -e "${GREEN}========================================${NC}"

    echo -e "\n${YELLOW}Package Size:${NC}"
    if [ -f pkg/agentdb_core_bg.wasm ]; then
        wasm_size=$(du -h pkg/agentdb_core_bg.wasm | cut -f1)
        echo -e "  WASM binary: ${wasm_size}"
    fi

    echo -e "\n${YELLOW}Next Steps:${NC}"
    echo -e "  1. Import in Node.js:"
    echo -e "     ${GREEN}import init, { AgentDB } from './pkg/agentdb_core.js';${NC}"
    echo -e "     ${GREEN}await init();${NC}"
    echo -e "     ${GREEN}const db = new AgentDB(384);${NC}"
    echo -e ""
    echo -e "  2. Add to package.json dependencies:"
    echo -e "     ${GREEN}\"agentdb_core\": \"file:./agentdb_core/pkg\"${NC}"
    echo -e ""
    echo -e "  3. Run integration tests:"
    echo -e "     ${GREEN}npm test${NC}"
}

# Main build flow
main() {
    check_prerequisites
    add_wasm_target

    case "$1" in
        --web)
            build_web
            ;;
        --test)
            run_tests
            ;;
        *)
            build_nodejs
            show_info
            ;;
    esac

    echo -e "\n${GREEN}✓ Build completed successfully!${NC}\n"
}

main "$@"
