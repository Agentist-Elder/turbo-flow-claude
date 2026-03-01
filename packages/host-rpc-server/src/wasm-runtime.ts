// WASM runtime management — re-exports from wasm-bridge.ts
// Callers that previously imported wasm-runtime directly remain compatible.
export { WasmGateBridge, buildMinimalSecurityRequest, buildSecurityRequestWithCallerId } from './wasm-bridge.js';
export type { RcDecision } from './wasm-bridge.js';
export { RC_ALLOW, RC_DENY, RC_CHALLENGE, RC_QUARANTINE } from './wasm-bridge.js';
