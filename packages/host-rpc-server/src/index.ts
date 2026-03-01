// Host-side RPC bridge — public API surface
// Phase 7: exports the Node-to-WASM bridge and FlatBuffers builder helpers.
export { WasmGateBridge, buildMinimalSecurityRequest, buildSecurityRequestWithCallerId } from './wasm-bridge.js';
export type { RcDecision } from './wasm-bridge.js';
export { RC_ALLOW, RC_DENY, RC_CHALLENGE, RC_QUARANTINE } from './wasm-bridge.js';
