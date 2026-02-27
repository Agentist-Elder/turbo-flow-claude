# SPARC Pseudocode Document
> Generated: 2026-02-27T17:29:52.307Z
> AIDefence: PASSED

---

This is a well-defined problem requiring a strict architectural split. The pseudocode provides a solid foundation, and the "split-brain boundary" directive is clear.

Here's a proposed concrete repository architecture, adhering to the specified language targets and workspace types, along with a detailed breakdown and rationale.

### Clarification Required

Before diving into the architecture, I need to clarify one point:
The request mentions "System 3 (Operator)". The provided pseudocode defines "Layer-3 API Gateway Orchestration". I am proceeding with the assumption that **"Layer-3 API Gateway Orchestration" is the primary component of "System 3 (Operator)"**.

RESPONSE REQUIRED: Please immediately continue using the continuation_id from this response to confirm if the Layer-3 API Gateway Orchestration is indeed System 3, or if System 3 is a distinct entity. Cannot proceed without your clarification/input.

### Repository Architecture Overview

The project will be structured as a monorepo using a combination of a Rust Cargo workspace and an NPM workspace (for TypeScript/Node.js). FlatBuffers schemas will be the single source of truth for inter-system communication, generating bindings for both Rust and TypeScript.

```
/workspaces/turbo-flow-claude/
├── Cargo.toml                  # Rust workspace root
├── package.json                # NPM workspace root
├── .npmrc                      # NPM workspace configuration (e.g., for pnpm/npm workspaces)
├── apps/                       # Node.js applications (NPM workspace)
│   ├── unix-adaptive-sentinel/ # System 2: Unix Adaptive Sentinel
│   └── l3-api-gateway/         # System 3: Layer-3 API Gateway Orchestration
├── packages/                   # Node.js packages/libraries (NPM workspace)
│   ├── host-rpc-server/        # Host-side (Unix) RPC bridge implementation
│   ├── rvf-memory-physics-node/# Node.js native addon for RVF Memory Physics (Rust via NAPI-RS)
│   ├── flatbuffers-schemas-ts/ # Generated TypeScript FlatBuffers bindings
│   └── common-types/           # Shared TypeScript types and utilities
├── crates/                     # Rust crates (Cargo workspace)
│   ├── wasm-security-gate/     # System 1: WASM Security Gate (compiles to .wasm)
│   ├── rvf-memory-physics/     # Core RVF Memory Physics library (Rust)
│   ├── wasm-rpc-client/        # WASM-side RPC client implementation
│   └── flatbuffers-schemas-rust/# Generated Rust FlatBuffers bindings
├── schemas/                    # FlatBuffers schema definition files (.fbs)
└── docs/
    └── research/
        └── Bunker-Pseudocode-v1.md
```

### Detailed Component Breakdown and Language Targets

#### Rust (Cargo Workspace)

This section will contain all Rust-based components, including the WASM Security Gate, the core RVF Memory Physics logic, and the WASM-side RPC client.

1.  **`crates/rvf-memory-physics`**
    *   **Purpose:** Implements the core `RVFMemoryPhysics` module as described in the pseudocode (lines 25-64). This includes the `ContinuousDeterministicMemory` struct and the `Initialize_Continuous_Deterministic_Memory`, `Apply_Pi_Derived_Quantization`, and `Update_Memory_With_Quantized_Delta` functions. This is the canonical, high-precision Rust implementation of RVF memory physics.
    *   **Language:** Rust
    *   **Type:** Library crate
    *   **Used by:** `crates/wasm-security-gate` (directly), `packages/rvf-memory-physics-node` (via `napi-rs` for Node.js binding).
    *   **Key Files:**
        *   `crates/rvf-memory-physics/Cargo.toml`
        *   `crates/rvf-memory-physics/src/lib.rs` (contains the `RVFMemoryPhysics` module logic)

2.  **`crates/wasm-security-gate`**
    *   **Purpose:** Implements System 1: WASM Security Gate (lines 66-181). This module will compile to a WebAssembly (`.wasm`) binary. It performs security checks and manages its probabilistic fingerprinting model using `rvf-memory-physics`. It makes RPC calls to Unix host services via `wasm-rpc-client`.
    *   **Language:** Rust (compiled to WASM)
    *   **Type:** Binary/Library crate (target `wasm32-unknown-unknown`)
    *   **Dependencies:** `rvf-memory-physics`, `wasm-rpc-client`, `flatbuffers-schemas-rust`.
    *   **Key Files:**
        *   `crates/wasm-security-gate/Cargo.toml`
        *   `crates/wasm-security-gate/src/lib.rs` (WASM entry point, `Init`, `Process_Security_Request` and helper functions)
        *   `crates/wasm-security-gate/src/config.rs` (for `WASMSecurityGateConfig`)
        *   `crates/wasm-security-gate/src/security_logic.rs` (for provenance, fingerprinting, DID validation, policy application)

3.  **`crates/wasm-rpc-client`**
    *   **Purpose:** Provides the WASM-side client implementation for the FlatBuffers WASM-to-Unix RPC Bridge (lines 511-534). It encapsulates the logic for serializing arguments, invoking host functions via the WASM runtime's import mechanism, and deserializing responses.
    *   **Language:** Rust
    *   **Type:** Library crate
    *   **Dependencies:** `flatbuffers-schemas-rust`, `wasm-bindgen` (for host function imports/exports).
    *   **Used by:** `crates/wasm-security-gate`.
    *   **Key Files:**
        *   `crates/wasm-rpc-client/Cargo.toml`
        *   `crates/wasm-rpc-client/src/lib.rs` (implements `WASM_Call_Unix_Function`, `WASM_Register_Callable_Function` and related WASM host interactions)

4.  **`crates/flatbuffers-schemas-rust`**
    *   **Purpose:** Contains the generated Rust code from the `.fbs` FlatBuffers schema definition files. This ensures type-safe, efficient serialization/deserialization for Rust components.
    *   **Language:** Rust (generated)
    *   **Type:** Library crate
    *   **Generated by:** `flatc --rust` command.
    *   **Key Files:**
        *   `crates/flatbuffers-schemas-rust/Cargo.toml`
        *   `crates/flatbuffers-schemas-rust/src/lib.rs` (contains generated modules for each schema)

#### TypeScript/Node.js (NPM Workspace)

This section will contain all TypeScript/Node.js-based components, including the Unix Adaptive Sentinel, the Layer-3 API Gateway, and the Host-side RPC bridge implementation.

1.  **`apps/unix-adaptive-sentinel`**
    *   **Purpose:** Implements System 2: Unix Adaptive Sentinel (lines 190-345). This is a native Node.js application responsible for monitoring, threat evaluation, and adaptive countermeasure orchestration. It uses the `rvf-memory-physics-node` package to apply RVF Memory Physics to its internal models. It makes RPC calls to other services via `host-rpc-server`.
    *   **Language:** TypeScript/Node.js
    *   **Type:** Node.js application
    *   **Dependencies:** `host-rpc-server`, `rvf-memory-physics-node`, `flatbuffers-schemas-ts`, `common-types`.
    *   **Key Files:**
        *   `apps/unix-adaptive-sentinel/package.json`
        *   `apps/unix-adaptive-sentinel/src/index.ts` (application entry point)
        *   `apps/unix-adaptive-sentinel/src/sentinel.ts` (main `UnixAdaptiveSentinel` logic, `Init`, `Process_Threat_Report`, `Evaluate_System_Behavior`, etc.)
        *   `apps/unix-adaptive-sentinel/src/config.ts` (for `UnixAdaptiveSentinelConfig`)
        *   `apps/unix-adaptive-sentinel/tsconfig.json`

2.  **`apps/l3-api-gateway`**
    *   **Purpose:** Implements Layer-3 API Gateway Orchestration (System 3) (lines 350-469). This is a stateless HTTP API gateway handling request routing, authentication, authorization, rate limiting, and service composition. It orchestrates calls to backend AI security microservices, utilizing the `host-rpc-server` for communication with WASM modules or other native services.
    *   **Language:** TypeScript/Node.js
    *   **Type:** Node.js application
    *   **Dependencies:** `host-rpc-server`, `flatbuffers-schemas-ts`, `common-types`, `express` or similar HTTP framework.
    *   **Key Files:**
        *   `apps/l3-api-gateway/package.json`
        *   `apps/l3-api-gateway/src/index.ts` (application entry point, HTTP server setup)
        *   `apps/l3-api-gateway/src/gateway.ts` (main `L3APIGateway` logic, `Handle_Incoming_Request` and helper functions)
        *   `apps/l3-api-gateway/src/config.ts` (for `L3APIGatewayConfig`)
        *   `apps/l3-api-gateway/tsconfig.json`

3.  **`packages/host-rpc-server`**
    *   **Purpose:** Implements the Unix/Host-side of the FlatBuffers WASM-to-Unix RPC Bridge (lines 536-600). This Node.js package manages the WASM runtime (e.g., using Node.js's built-in `WebAssembly` API or `wasmtime-js`), registers native host functions callable by WASM, and provides an interface for Node.js applications to call WASM-exported functions. It implements `Unix_Register_Host_Function`, `Unix_Host_Function_Handler`, and `Unix_Call_WASM_Function`.
    *   **Language:** TypeScript/Node.js
    *   **Type:** Node.js package
    *   **Dependencies:** `flatbuffers-schemas-ts`, `common-types`, `node:wasi` or `wasmtime-js`.
    *   **Key Files:**
        *   `packages/host-rpc-server/package.json`
        *   `packages/host-rpc-server/src/index.ts` (exports the RPC bridge interface)
        *   `packages/host-rpc-server/src/rpc-bridge.ts` (core bridge logic, function registries)
        *   `packages/host-rpc-server/src/wasm-runtime.ts` (WASM module loading and interaction)
        *   `packages/host-rpc-server/tsconfig.json`

4.  **`packages/rvf-memory-physics-node`**
    *   **Purpose:** A Node.js native addon that exposes the Rust `crates/rvf-memory-physics` library to TypeScript/Node.js. This allows `apps/unix-adaptive-sentinel` to directly call the Rust-implemented RVF Memory Physics functions on its local state, satisfying the requirement that RVF Memory Physics is Rust while System 2 is TypeScript. This will be implemented using `napi-rs`.
    *   **Language:** TypeScript (wrapper) and Rust (native addon implementation)
    *   **Type:** Node.js package with native bindings
    *   **Dependencies:** `crates/rvf-memory-physics` (Rust side).
    *   **Key Files:**
        *   `packages/rvf-memory-physics-node/package.json`
        *   `packages/rvf-memory-physics-node/src/index.ts` (TypeScript wrapper for the native addon)
        *   `packages/rvf-memory-physics-node/rust/Cargo.toml` (NAPI-RS specific configuration, linking to `crates/rvf-memory-physics`)
        *   `packages/rvf-memory-physics-node/rust/src/lib.rs` (NAPI-RS bindings, exposing Rust functions to Node.js)
        *   `packages/rvf-memory-physics-node/tsconfig.json`

5.  **`packages/flatbuffers-schemas-ts`**
    *   **Purpose:** Contains the generated TypeScript code from the `.fbs` FlatBuffers schema definition files. This ensures type-safe, efficient serialization/deserialization for TypeScript components.
    *   **Language:** TypeScript (generated)
    *   **Type:** Node.js package
    *   **Generated by:** `flatc --ts` command.
    *   **Key Files:**
        *   `packages/flatbuffers-schemas-ts/package.json`
        *   `packages/flatbuffers-schemas-ts/src/index.ts` (contains generated classes/interfaces for each schema)
        *   `packages/flatbuffers-schemas-ts/tsconfig.json`

6.  **`packages/common-types`**
    *   **Purpose:** Provides shared TypeScript interfaces, enums, and utility types that are common across multiple Node.js applications and packages. This helps maintain consistency and reduces duplication.
    *   **Language:** TypeScript
    *   **Type:** Node.js package
    *   **Key Files:**
        *   `packages/common-types/package.json`
        *   `packages/common-types/src/index.ts`
        *   `packages/common-types/tsconfig.json`

#### Shared Resources

1.  **`schemas/`**
    *   **Purpose:** Directory containing all `.fbs` FlatBuffers schema definition files. These files define the data structures and RPC message formats used for inter-component communication. They are the single source of truth for serialization contracts.
    *   **Language:** FlatBuffers IDL
    *   **Key Files:**
        *   `schemas/rpc_messages.fbs` (defines common RPC request/response structures)
        *   `schemas/security_gate.fbs` (defines messages specific to WASM Security Gate interactions)
        *   `schemas/sentinel_messages.fbs` (defines messages specific to Unix Adaptive Sentinel interactions)
        *   `schemas/l3_gateway.fbs` (defines messages specific to L3 API Gateway interactions)

### Workspace Configuration Files

**Root `package.json` (NPM Workspace)**

```json
{
  "name": "mothership-tri-system",
  "version": "1.0.0",
  "description": "Mothership Tri-System Monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "clean": "rm -rf dist target",
    "generate:flatbuffers": "flatc --rust -o crates/flatbuffers-schemas-rust/src schemas/*.fbs && flatc --ts -o packages/flatbuffers-schemas-ts/src schemas/*.fbs",
    "build:rust-libs": "cargo build --workspace --release",
    "build:wasm-security-gate": "cd crates/wasm-security-gate && cargo build --target wasm32-unknown-unknown --release",
    "build:rvf-node-addon": "cd packages/rvf-memory-physics-node/rust && cargo build --release",
    "build:ts": "npm run build -w apps/unix-adaptive-sentinel -w apps/l3-api-gateway -w packages/host-rpc-server -w packages/rvf-memory-physics-node -w packages/flatbuffers-schemas-ts -w packages/common-types",
    "build": "npm run clean && npm run generate:flatbuffers && npm run build:rust-libs && npm run build:wasm-security-gate && npm run build:rvf-node-addon && npm run build:ts"
  },
  "devDependencies": {
    "typescript": "^5.x.x",
    "@types/node": "^20.x.x",
    "flatbuffers": "^23.x.x"
    // Add other monorepo-level dev dependencies like linting tools, etc.
  }
}
```

**Root `Cargo.toml` (Rust Workspace)**

```toml
[workspace]
members = [
    "crates/wasm-security-gate",
    "crates/rvf-memory-physics",
    "crates/wasm-rpc-client",
    "crates/flatbuffers-schemas-rust",
]
resolver = "2" # Use the new cargo resolver
```

### Rationale for Key Decisions

1.  **RVF Memory Physics Implementation:** The pseudocode shows `RVFMemoryPhysics` being used by both Rust (WASM Gate) and TypeScript (Unix Sentinel). To strictly enforce "RVF Memory Physics... must be Rust" while allowing the TypeScript Sentinel to use it, we introduce `packages/rvf-memory-physics-node`. This Node.js native addon, built with `napi-rs`, wraps the core Rust `crates/rvf-memory-physics` library. This allows the TypeScript Sentinel to call Rust functions directly, operating on its local data structures (represented in TypeScript), without requiring `RVFMemoryPhysics` itself to be a WASM module or duplicating the complex logic in TypeScript.
2.  **RPC Bridge Split:** The `FlatBuffers WASM-to-Unix RPC Bridge` is naturally split. Its WASM-side components (`WASM_Call_Unix_Function`, `WASM_Register_Callable_Function`) are implemented in Rust within `crates/wasm-rpc-client`. Its Unix/Host-side components (`Unix_Register_Host_Function`, `Unix_Host_Function_Handler`, `Unix_Call_WASM_Function`) are implemented in TypeScript within `packages/host-rpc-server`. This maintains the language boundary for each part of the bridge.
3.  **FlatBuffers for IPC:** Using FlatBuffers with generated code for both Rust and TypeScript (`crates/flatbuffers-schemas-rust`, `packages/flatbuffers-schemas-ts`) ensures high-performance, zero-copy serialization/deserialization, which is critical for the low-latency requirements of the RPC bridge. The `schemas/` directory serves as the single source of truth for all message definitions.
4.  **Monorepo Structure:** A monorepo with distinct Cargo and NPM workspaces simplifies dependency management, code sharing (especially for FlatBuffers schemas), and consistent build processes across the mixed-language codebase.

This architecture provides a clear separation of concerns, adheres to the strict language boundaries, and offers practical solutions for cross-language interaction where necessary, grounded in the provided pseudocode and project constraints.