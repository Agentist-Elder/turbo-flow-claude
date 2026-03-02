/**
 * Phase 11 — Coherence Router (The Thin Conductor)
 *
 * Sits between external Daughter agents (via CoherenceClient) and the
 * Phase 9 L3 Gateway. Classifies every payload into one of three streams:
 *
 *   clean      — RC_ALLOW: payload is safe, forward to the clean stream.
 *   quarantined — RC_DENY | RC_CHALLENGE | RC_QUARANTINE: daughter is
 *                 considered compromised; neuralyzer callback fires.
 *   dropped    — Gateway error (protocol or connection): fail-closed;
 *                drop the payload and log; neuralyzer does NOT fire
 *                (infrastructure failure ≠ daughter compromise).
 *
 * QuarantineMode controls what the orchestrator does with quarantined data:
 *   reject   — Drop the payload entirely; do not process further.
 *   sanitize — Flag the payload for the Phase 21 recursive chunker to
 *              remove contaminated segments before any downstream use.
 *
 * Routing matrix:
 *   RC_ALLOW                       → clean     (no neuralyzer)
 *   RC_DENY | RC_CHALLENGE | RC_QUARANTINE → quarantined (neuralyzer fires)
 *   CoherenceProtocolError (4xx)   → dropped   (no neuralyzer, onDropped fires)
 *   CoherenceConnectionError (5xx / network) → dropped (no neuralyzer, onDropped fires)
 */

import {
  CoherenceClient,
  CoherenceProtocolError,
  CoherenceConnectionError,
} from './coherence-client.js';
import type { CoherenceResult } from './coherence-client.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** How quarantined payloads are handled by the orchestrator. */
export type QuarantineMode = 'reject' | 'sanitize';

/** The three possible outcomes of a routing decision. */
export type RouterOutcome = 'clean' | 'quarantined' | 'dropped';

/**
 * Immutable record attached to every quarantined payload.
 * Passed to onDaughterCompromised and available on RouterResult.
 *
 * mode='reject'   → orchestrator drops payload; no further processing.
 * mode='sanitize' → orchestrator forwards to Phase 21 decontaminate().
 */
export interface QuarantineRecord {
  /** ID of the Daughter agent that produced the payload. */
  daughterId: string;
  /** Raw payload bytes (UTF-8 encoded if the original was a string). */
  payload: Buffer;
  /** What the WASM gate decided (never 'allow'). */
  decision: 'deny' | 'challenge' | 'quarantine';
  /** What the orchestrator should do with this record. */
  mode: QuarantineMode;
  /** Monotonic nanosecond timestamp at the moment of quarantine. */
  timestampNs: bigint;
}

/** Result returned by CoherenceRouter.route(). */
export interface RouterResult {
  outcome: RouterOutcome;
  /**
   * Gate decision — present for 'clean' (always 'allow') and 'quarantined'
   * outcomes. Absent for 'dropped' (gate never ran).
   */
  decision?: CoherenceResult['decision'];
  daughterId: string;
  /** Populated only when outcome === 'quarantined'. */
  quarantineRecord?: QuarantineRecord;
}

export interface RouterConfig {
  /** Base URL of the Phase 9 L3 Gateway. */
  gatewayUrl: string;

  /**
   * How to handle quarantined payloads.
   * Stored in QuarantineRecord.mode and passed to onDaughterCompromised
   * so the orchestrator can apply the correct downstream policy.
   */
  quarantineMode: QuarantineMode;

  /**
   * Fired when the gate returns RC_DENY, RC_CHALLENGE, or RC_QUARANTINE.
   * The originating Daughter agent is considered compromised.
   * The orchestrator should SIGKILL daughterId and respawn a clean instance.
   *
   * @param daughterId  ID of the compromised Daughter agent.
   * @param record      Full quarantine record including payload and mode.
   */
  onDaughterCompromised: (daughterId: string, record: QuarantineRecord) => void;

  /**
   * Optional. Fired when the gateway returns a protocol or connection error
   * and the payload is dropped (fail-closed). The gate never ran.
   * This is an infrastructure event, NOT a daughter compromise.
   *
   * @param daughterId  ID of the Daughter whose payload was dropped.
   * @param reason      'protocol-error:<statusCode>' or 'connection-error'.
   * @param error       The original CoherenceProtocolError or CoherenceConnectionError.
   */
  onDropped?: (daughterId: string, reason: string, error: unknown) => void;
}

// ---------------------------------------------------------------------------
// CoherenceRouter
// ---------------------------------------------------------------------------

/**
 * CoherenceRouter — The Thin Conductor.
 *
 * Holds no mutable state beyond the CoherenceClient and config.
 * Safe to share across concurrent callers; each route() call is independent.
 */
export class CoherenceRouter {
  private readonly client: CoherenceClient;
  private readonly config: RouterConfig;

  constructor(config: RouterConfig) {
    this.client = new CoherenceClient({ gatewayUrl: config.gatewayUrl });
    this.config = config;
  }

  /**
   * Route a payload through the coherence gate.
   *
   * @param payload    Content to check. Strings are UTF-8 encoded before
   *                   transmission and stored as Buffer in QuarantineRecord.
   * @param daughterId Identifier of the originating Daughter agent.
   *                   Used in callbacks and quarantine records.
   *
   * @returns RouterResult describing the outcome (clean | quarantined | dropped).
   *          Never throws — all gateway errors are caught and fail-closed internally.
   */
  async route(payload: string | Buffer, daughterId: string): Promise<RouterResult> {
    const body = typeof payload === 'string'
      ? Buffer.from(payload, 'utf-8')
      : payload;

    // -----------------------------------------------------------------------
    // Call the gate — catch both error classes for fail-closed behaviour.
    // -----------------------------------------------------------------------
    let result: CoherenceResult;
    try {
      result = await this.client.verifyDecision(body);
    } catch (err) {
      // Both CoherenceProtocolError and CoherenceConnectionError mean the gate
      // never ran. Fail-closed: drop the payload and log — no neuralyzer.
      const reason = err instanceof CoherenceProtocolError
        ? `protocol-error:${(err as CoherenceProtocolError).statusCode}`
        : 'connection-error';

      this.config.onDropped?.(daughterId, reason, err);
      return { outcome: 'dropped', daughterId };
    }

    // -----------------------------------------------------------------------
    // RC_ALLOW — clean stream.
    // -----------------------------------------------------------------------
    if (result.decision === 'allow') {
      return { outcome: 'clean', decision: 'allow', daughterId };
    }

    // -----------------------------------------------------------------------
    // RC_DENY | RC_CHALLENGE | RC_QUARANTINE — daughter compromised.
    // TypeScript narrows result.decision to 'deny' | 'challenge' | 'quarantine'
    // after the 'allow' guard above.
    // -----------------------------------------------------------------------
    const record: QuarantineRecord = {
      daughterId,
      payload: body,
      decision: result.decision,
      mode:     this.config.quarantineMode,
      timestampNs: process.hrtime.bigint(),
    };

    // Fire the neuralyzer: orchestrator must SIGKILL and respawn this daughter.
    this.config.onDaughterCompromised(daughterId, record);

    return {
      outcome: 'quarantined',
      decision: result.decision,
      daughterId,
      quarantineRecord: record,
    };
  }
}
