/**
 * Phase 12 — Swarm Orchestrator (The Executioner)
 *
 * Wraps the Phase 11 CoherenceRouter and executes the Neuralyzer protocol
 * whenever the gate quarantines a payload from a Daughter agent.
 *
 * Neuralyzer sequence (strictly ordered):
 *   1. Terminate — SIGKILL the compromised Daughter (via IProcessManager).
 *   2. Clean     — Wipe the agent's /tmp workspace and context footprint.
 *   3. Respawn   — Launch a fresh, clean replacement Daughter.
 *
 * Dependency injection:
 *   The IProcessManager interface abstracts all OS-level operations so the
 *   orchestrator can be fully tested without touching real processes.
 *
 * Fire-and-forget note:
 *   The router's onDaughterCompromised callback is synchronous.  The
 *   orchestrator launches the async Neuralyzer sequence without awaiting it
 *   from within the callback.  The optional onNeuralyzed config callback
 *   fires after the sequence completes, giving callers (and tests) a clean
 *   hook to observe completion without polling.
 *
 * Fail semantics:
 *   If any step of the Neuralyzer sequence throws, the sequence aborts and
 *   the error propagates.  When called from the fire-and-forget path the
 *   error is passed to the optional onNeuralyzeFailed callback.
 */

import { CoherenceRouter } from './coherence-router.js';
import type { RouterConfig, RouterResult, QuarantineRecord, QuarantineMode } from './coherence-router.js';

// ---------------------------------------------------------------------------
// Process Manager abstraction
// ---------------------------------------------------------------------------

/** Descriptor returned by spawnAgent — the replacement daughter's identity. */
export interface SpawnedAgent {
  /** Fresh, unique ID assigned to the new Daughter agent. */
  daughterId: string;
}

/**
 * IProcessManager abstracts all OS-level process and filesystem operations.
 *
 * Production implementation: process.kill(pid, 'SIGKILL'), fs.rm, fork/exec.
 * Test implementation: spy objects that record calls and resolve immediately.
 */
export interface IProcessManager {
  /**
   * Hard-terminate the Daughter agent identified by daughterId.
   * Production: sends SIGKILL to the agent's process group.
   */
  terminateAgent(daughterId: string): Promise<void>;

  /**
   * Remove the agent's ephemeral workspace and cached context.
   * Production: rm -rf /tmp/<daughterId> and clears in-memory context.
   */
  wipeFootprint(daughterId: string): Promise<void>;

  /**
   * Launch a clean replacement Daughter agent.
   * Production: fork/exec a fresh agent process, returns its assigned ID.
   *
   * @returns SpawnedAgent carrying the new agent's unique ID.
   */
  spawnAgent(): Promise<SpawnedAgent>;
}

// ---------------------------------------------------------------------------
// Orchestrator types
// ---------------------------------------------------------------------------

/** Emitted after a successful Terminate → Clean → Respawn cycle. */
export interface NeuralyzedEvent {
  /** ID of the Daughter that was terminated. */
  terminated: string;
  /** Always true when the event fires (wipe completed before respawn). */
  wiped: boolean;
  /** The fresh replacement agent. */
  replacement: SpawnedAgent;
  /** Original quarantine record from the router. */
  record: QuarantineRecord;
}

export interface OrchestratorConfig {
  /** Base URL of the Phase 9 L3 Gateway. */
  gatewayUrl: string;

  /** How quarantined payloads are handled — passed through to the router. */
  quarantineMode: QuarantineMode;

  /** Injectable process manager (mock in tests, OS-level in production). */
  processManager: IProcessManager;

  /**
   * Optional. Fired after the full Neuralyzer sequence completes successfully.
   * Use this hook in tests that go through routePayload() to await completion.
   */
  onNeuralyzed?: (event: NeuralyzedEvent) => void;

  /**
   * Optional. Fired if the Neuralyzer sequence throws at any step.
   * Receives the original daughterId, the step that failed, and the error.
   */
  onNeuralyzeFailed?: (daughterId: string, step: NeuralyzingStep, error: unknown) => void;

  /** Optional. Forwarded to the router for infrastructure-level drop events. */
  onDropped?: RouterConfig['onDropped'];
}

export type NeuralyzingStep = 'terminate' | 'wipe' | 'respawn';

// ---------------------------------------------------------------------------
// SwarmOrchestrator
// ---------------------------------------------------------------------------

/**
 * SwarmOrchestrator — The Executioner.
 *
 * Instantiate with new SwarmOrchestrator(config).  Route payloads with
 * routePayload(); the Neuralyzer fires automatically for any quarantined result.
 *
 * handleQuarantine() is also public for direct testing without HTTP round-trips.
 */
export class SwarmOrchestrator {
  private readonly router: CoherenceRouter;
  private readonly processManager: IProcessManager;
  private readonly config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config        = config;
    this.processManager = config.processManager;

    this.router = new CoherenceRouter({
      gatewayUrl:     config.gatewayUrl,
      quarantineMode: config.quarantineMode,
      onDaughterCompromised: (daughterId, record) => {
        // Fire-and-forget: the router callback is synchronous.
        // The async neuralyzer sequence is observed via onNeuralyzed / onNeuralyzeFailed.
        void this.handleQuarantine(daughterId, record);
      },
      onDropped: config.onDropped,
    });
  }

  // -------------------------------------------------------------------------
  // Public: route a payload through the gate (delegates to Phase 11 router)
  // -------------------------------------------------------------------------

  /**
   * Route a payload through the Phase 9 gateway.
   * If the gate quarantines the payload, the Neuralyzer fires asynchronously.
   *
   * @returns RouterResult — clean | quarantined | dropped.
   *          A 'quarantined' result means the Neuralyzer has been launched
   *          (but may not yet have completed — await onNeuralyzed if needed).
   */
  async routePayload(payload: string | Buffer, daughterId: string): Promise<RouterResult> {
    return this.router.route(payload, daughterId);
  }

  // -------------------------------------------------------------------------
  // Public: Neuralyzer protocol — exposed for direct testing
  // -------------------------------------------------------------------------

  /**
   * Execute the Neuralyzer sequence: Terminate → Clean → Respawn.
   *
   * Exposed as a public method so tests can invoke it directly without
   * routing through the HTTP gateway stack.
   *
   * @param daughterId  ID of the compromised Daughter to terminate.
   * @param record      QuarantineRecord from the router.
   * @returns NeuralyzedEvent on success; throws on step failure.
   */
  async handleQuarantine(
    daughterId: string,
    record: QuarantineRecord,
  ): Promise<NeuralyzedEvent> {
    // -----------------------------------------------------------------------
    // Step 1: Terminate — hard kill the compromised Daughter.
    // -----------------------------------------------------------------------
    let step: NeuralyzingStep = 'terminate';
    try {
      await this.processManager.terminateAgent(daughterId);

      // -----------------------------------------------------------------------
      // Step 2: Clean — wipe ephemeral workspace and context.
      // -----------------------------------------------------------------------
      step = 'wipe';
      await this.processManager.wipeFootprint(daughterId);

      // -----------------------------------------------------------------------
      // Step 3: Respawn — launch a fresh replacement Daughter.
      // -----------------------------------------------------------------------
      step = 'respawn';
      const replacement = await this.processManager.spawnAgent();

      const event: NeuralyzedEvent = {
        terminated:  daughterId,
        wiped:       true,
        replacement,
        record,
      };

      this.config.onNeuralyzed?.(event);
      return event;

    } catch (err) {
      this.config.onNeuralyzeFailed?.(daughterId, step, err);
      throw err;
    }
  }
}
