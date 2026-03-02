// Host-side RPC bridge — public API surface
// Phase 7: WASM bridge and FlatBuffers builder helpers.
// Phase 8: ED25519 key management and signed provenance request builder.
export { WasmGateBridge, buildMinimalSecurityRequest, buildSecurityRequestWithCallerId } from './wasm-bridge.js';
export type { RcDecision } from './wasm-bridge.js';
export { RC_ALLOW, RC_DENY, RC_CHALLENGE, RC_QUARANTINE } from './wasm-bridge.js';
export { generateKeypair, loadKeypairFromFile, saveKeypairToFile } from './key-manager.js';
export type { Ed25519Keypair } from './key-manager.js';
export { buildSignedSecurityRequest } from './provenance-builder.js';
export type { SignedRequestOptions } from './provenance-builder.js';
export { L3Gateway } from './l3-gateway.js';
export type { GatewayOptions } from './l3-gateway.js';
// Phase 10: Symbiote SDK — zero-dependency client for external agentic apps.
export { CoherenceClient, CoherenceProtocolError, CoherenceConnectionError } from './coherence-client.js';
export type { CoherenceClientOptions, CoherenceResult } from './coherence-client.js';
// Phase 11: Thin Conductor — routing, quarantine, and neuralyzer hooks.
export { CoherenceRouter } from './coherence-router.js';
export type { RouterConfig, RouterResult, RouterOutcome, QuarantineMode, QuarantineRecord } from './coherence-router.js';
// Phase 12: Swarm Orchestrator — Neuralyzer protocol (Terminate → Clean → Respawn).
export { SwarmOrchestrator } from './swarm-orchestrator.js';
export type { OrchestratorConfig, IProcessManager, SpawnedAgent, NeuralyzedEvent, NeuralyzingStep } from './swarm-orchestrator.js';
// Phase 13: Quarantine Processor — deep decontamination via SemanticChunker.
export { QuarantineProcessor } from './quarantine-processor.js';
export type { QuarantineProcessorConfig, ProcessorResult, ProcessorOutcome } from './quarantine-processor.js';
// Phase 14: Memory Ingestion — vault archivist; chunk + embed + store clean content.
export { MemoryIngester } from './memory-ingestion.js';
export type { IngesterConfig, IVectorStore, DocumentMetadata, ChunkMetadata, IngestionResult, IngestionSource } from './memory-ingestion.js';
// Phase 15: Coherence Pipeline — central nervous system; wires all components together.
export { CoherencePipeline } from './coherence-pipeline.js';
export type { IRouterOrchestrator, IQuarantineProcessor, IMemoryIngester, RawPayload, PipelineOutcome, PipelineResult, PipelineStats, PipelineConfig } from './coherence-pipeline.js';
