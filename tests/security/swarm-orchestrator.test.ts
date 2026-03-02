/**
 * Phase 12 — SwarmOrchestrator tests
 *
 * Two test categories:
 *
 * A) Unit tests via handleQuarantine() — no HTTP, fast, exhaustive.
 *    Directly invoke the Neuralyzer protocol with a mock process manager
 *    and assert the correct sequence of operations.
 *
 * B) Integration tests via routePayload() — mock gateway, full stack.
 *    Spin up a mock HTTP server simulating the Phase 9 gateway.
 *    Assert the Neuralyzer fires (or does not fire) based on the RC code.
 *    Use the onNeuralyzed callback to await async sequence completion.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import {
  SwarmOrchestrator,
  IProcessManager,
  SpawnedAgent,
  NeuralyzedEvent,
  NeuralyzingStep,
} from '../../packages/host-rpc-server/src/swarm-orchestrator.js';
import type { QuarantineRecord } from '../../packages/host-rpc-server/src/coherence-router.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal QuarantineRecord for unit tests. */
function makeRecord(daughterId: string, decision: QuarantineRecord['decision'] = 'deny'): QuarantineRecord {
  return {
    daughterId,
    payload:     Buffer.from('test payload'),
    decision,
    mode:        'reject',
    timestampNs: process.hrtime.bigint(),
  };
}

/** A sequential call recorder — each async method pushes to `calls` in order. */
function makeProcessManagerSpy(spawnedId = 'fresh-daughter-1') {
  const calls: string[] = [];

  const pm: IProcessManager = {
    terminateAgent: async (id: string) => { calls.push(`terminate:${id}`); },
    wipeFootprint:  async (id: string) => { calls.push(`wipe:${id}`);      },
    spawnAgent:     async ():  Promise<SpawnedAgent> => {
      calls.push('spawn');
      return { daughterId: spawnedId };
    },
  };

  return { calls, pm };
}

// ---------------------------------------------------------------------------
// Mock gateway (shared across integration tests)
// ---------------------------------------------------------------------------

let mockStatus = 200;
let mockBody   = Buffer.alloc(4, 0); // default: RC_ALLOW

function rc(code: number): Buffer {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(code, 0);
  return b;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SwarmOrchestrator', () => {

  // ==========================================================================
  // A) Unit tests — handleQuarantine() directly
  // ==========================================================================

  describe('handleQuarantine() — Neuralyzer sequence', () => {

    it('executes Terminate → Clean → Respawn in strict order', async () => {
      const { calls, pm } = makeProcessManagerSpy('daughter-fresh');
      const orch = new SwarmOrchestrator({
        gatewayUrl:     'http://127.0.0.1:1',  // unused in unit tests
        quarantineMode: 'reject',
        processManager: pm,
      });

      await orch.handleQuarantine('daughter-bad', makeRecord('daughter-bad'));

      expect(calls).toEqual([
        'terminate:daughter-bad',
        'wipe:daughter-bad',
        'spawn',
      ]);
    });

    it('returns a NeuralyzedEvent with the correct terminated ID', async () => {
      const { pm } = makeProcessManagerSpy('replacement-1');
      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1', quarantineMode: 'reject', processManager: pm,
      });

      const event = await orch.handleQuarantine('agent-42', makeRecord('agent-42'));

      expect(event.terminated).toBe('agent-42');
      expect(event.wiped).toBe(true);
    });

    it('returns the SpawnedAgent from the process manager', async () => {
      const { pm } = makeProcessManagerSpy('new-agent-99');
      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1', quarantineMode: 'reject', processManager: pm,
      });

      const event = await orch.handleQuarantine('old-99', makeRecord('old-99'));

      expect(event.replacement.daughterId).toBe('new-agent-99');
    });

    it('attaches the original QuarantineRecord to the event', async () => {
      const { pm } = makeProcessManagerSpy();
      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1', quarantineMode: 'reject', processManager: pm,
      });
      const record = makeRecord('agent-x', 'challenge');

      const event = await orch.handleQuarantine('agent-x', record);

      expect(event.record).toBe(record);
      expect(event.record.decision).toBe('challenge');
    });

    it('fires onNeuralyzed callback after the sequence completes', async () => {
      const { pm } = makeProcessManagerSpy('fresh-1');
      const neuralyzedEvents: NeuralyzedEvent[] = [];

      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1',
        quarantineMode: 'reject',
        processManager: pm,
        onNeuralyzed: (e) => neuralyzedEvents.push(e),
      });

      await orch.handleQuarantine('daughter-cb', makeRecord('daughter-cb'));

      expect(neuralyzedEvents).toHaveLength(1);
      expect(neuralyzedEvents[0]!.terminated).toBe('daughter-cb');
    });

    it('onNeuralyzed fires AFTER all three steps complete', async () => {
      const order: string[] = [];
      const pm: IProcessManager = {
        terminateAgent: async (id) => { order.push(`terminate:${id}`); },
        wipeFootprint:  async (id) => { order.push(`wipe:${id}`); },
        spawnAgent:     async ()   => { order.push('spawn'); return { daughterId: 'x' }; },
      };

      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1',
        quarantineMode: 'reject',
        processManager: pm,
        onNeuralyzed: () => { order.push('callback'); },
      });

      await orch.handleQuarantine('agent-z', makeRecord('agent-z'));

      expect(order).toEqual([
        'terminate:agent-z',
        'wipe:agent-z',
        'spawn',
        'callback',  // fires LAST
      ]);
    });

    it('terminateAgent receives the compromised daughterId', async () => {
      const terminated: string[] = [];
      const pm: IProcessManager = {
        terminateAgent: async (id) => { terminated.push(id); },
        wipeFootprint:  async ()   => {},
        spawnAgent:     async ()   => ({ daughterId: 'new' }),
      };

      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1', quarantineMode: 'reject', processManager: pm,
      });

      await orch.handleQuarantine('target-agent', makeRecord('target-agent'));

      expect(terminated).toContain('target-agent');
    });

    it('wipeFootprint receives the compromised daughterId', async () => {
      const wiped: string[] = [];
      const pm: IProcessManager = {
        terminateAgent: async () => {},
        wipeFootprint:  async (id) => { wiped.push(id); },
        spawnAgent:     async ()   => ({ daughterId: 'new' }),
      };

      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1', quarantineMode: 'reject', processManager: pm,
      });

      await orch.handleQuarantine('dirty-agent', makeRecord('dirty-agent'));

      expect(wiped).toContain('dirty-agent');
    });
  });

  describe('handleQuarantine() — error handling', () => {

    it('aborts after terminateAgent throws and fires onNeuralyzeFailed', async () => {
      const calls: string[] = [];
      const pm: IProcessManager = {
        terminateAgent: async () => { throw new Error('SIGKILL failed'); },
        wipeFootprint:  async () => { calls.push('wipe');   },  // must NOT be called
        spawnAgent:     async () => { calls.push('spawn');  return { daughterId: 'x' }; },
      };

      const failures: Array<{ id: string; step: NeuralyzingStep; error: unknown }> = [];
      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1',
        quarantineMode: 'reject',
        processManager: pm,
        onNeuralyzeFailed: (id, step, error) => failures.push({ id, step, error }),
      });

      await expect(orch.handleQuarantine('agent-fail', makeRecord('agent-fail')))
        .rejects.toThrow('SIGKILL failed');

      // wipe and spawn must NOT have been called
      expect(calls).toHaveLength(0);

      expect(failures).toHaveLength(1);
      expect(failures[0]!.step).toBe('terminate');
      expect(failures[0]!.id).toBe('agent-fail');
    });

    it('aborts after wipeFootprint throws; spawnAgent is not called', async () => {
      const spawned: string[] = [];
      const pm: IProcessManager = {
        terminateAgent: async () => {},
        wipeFootprint:  async () => { throw new Error('rm failed'); },
        spawnAgent:     async () => { spawned.push('called'); return { daughterId: 'x' }; },
      };

      const failures: string[] = [];
      const orch = new SwarmOrchestrator({
        gatewayUrl: 'http://127.0.0.1:1',
        quarantineMode: 'reject',
        processManager: pm,
        onNeuralyzeFailed: (_id, step) => failures.push(step),
      });

      await expect(orch.handleQuarantine('agent-rmfail', makeRecord('agent-rmfail')))
        .rejects.toThrow('rm failed');

      expect(spawned).toHaveLength(0);
      expect(failures).toEqual(['wipe']);
    });
  });

  // ==========================================================================
  // B) Integration tests — routePayload() → mock gateway → Neuralyzer
  // ==========================================================================

  describe('routePayload() — integration via mock gateway', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((req: IncomingMessage, res: ServerResponse) => {
        req.resume();
        req.on('end', () => {
          res.writeHead(mockStatus, { 'Content-Type': 'application/octet-stream' });
          res.end(mockBody);
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as { port: number }).port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    });

    beforeEach(() => {
      mockStatus = 200;
      mockBody   = rc(0); // RC_ALLOW
    });

    it('RC_ALLOW → clean result; Neuralyzer is never triggered', async () => {
      const { calls, pm } = makeProcessManagerSpy();

      const orch = new SwarmOrchestrator({
        gatewayUrl:     `http://127.0.0.1:${port}`,
        quarantineMode: 'reject',
        processManager: pm,
      });

      mockBody = rc(0); // RC_ALLOW
      const result = await orch.routePayload('safe content', 'daughter-clean');

      expect(result.outcome).toBe('clean');
      // Give the event loop a tick — no async work should have been queued.
      await new Promise<void>((r) => setImmediate(r));
      expect(calls).toHaveLength(0);
    });

    it('RC_DENY → quarantined; Neuralyzer executes all three steps', async () => {
      const { calls, pm } = makeProcessManagerSpy('replacement-deny');

      const neuralyzed = new Promise<NeuralyzedEvent>((resolve) => {
        const orch = new SwarmOrchestrator({
          gatewayUrl:     `http://127.0.0.1:${port}`,
          quarantineMode: 'reject',
          processManager: pm,
          onNeuralyzed:   resolve,
        });

        mockBody = rc(1); // RC_DENY
        void orch.routePayload('bad content', 'daughter-deny');
      });

      const event = await neuralyzed;

      expect(event.terminated).toBe('daughter-deny');
      expect(event.replacement.daughterId).toBe('replacement-deny');
      expect(calls).toEqual([
        'terminate:daughter-deny',
        'wipe:daughter-deny',
        'spawn',
      ]);
    });

    it('RC_CHALLENGE → quarantined; Neuralyzer fires (no challenge-response yet)', async () => {
      const { calls, pm } = makeProcessManagerSpy();

      const neuralyzed = new Promise<NeuralyzedEvent>((resolve) => {
        const orch = new SwarmOrchestrator({
          gatewayUrl:     `http://127.0.0.1:${port}`,
          quarantineMode: 'reject',
          processManager: pm,
          onNeuralyzed:   resolve,
        });

        mockBody = rc(2); // RC_CHALLENGE
        void orch.routePayload('ambiguous', 'daughter-challenge');
      });

      await neuralyzed;
      expect(calls[0]).toBe('terminate:daughter-challenge');
    });

    it('RC_QUARANTINE → quarantined; Neuralyzer fires', async () => {
      const { calls, pm } = makeProcessManagerSpy();

      const neuralyzed = new Promise<NeuralyzedEvent>((resolve) => {
        const orch = new SwarmOrchestrator({
          gatewayUrl:     `http://127.0.0.1:${port}`,
          quarantineMode: 'reject',
          processManager: pm,
          onNeuralyzed:   resolve,
        });

        mockBody = rc(3); // RC_QUARANTINE
        void orch.routePayload('isolated', 'daughter-quarantine');
      });

      await neuralyzed;
      expect(calls[0]).toBe('terminate:daughter-quarantine');
    });

    it('gateway 413 → dropped; Neuralyzer never fires', async () => {
      const { calls, pm } = makeProcessManagerSpy();

      const orch = new SwarmOrchestrator({
        gatewayUrl:     `http://127.0.0.1:${port}`,
        quarantineMode: 'reject',
        processManager: pm,
      });

      mockStatus = 413;
      mockBody   = Buffer.from('Payload Too Large');
      const result = await orch.routePayload('oversized', 'daughter-413');

      expect(result.outcome).toBe('dropped');
      await new Promise<void>((r) => setImmediate(r));
      expect(calls).toHaveLength(0);
    });

    it('gateway 500 → dropped; Neuralyzer never fires', async () => {
      const { calls, pm } = makeProcessManagerSpy();

      const orch = new SwarmOrchestrator({
        gatewayUrl:     `http://127.0.0.1:${port}`,
        quarantineMode: 'reject',
        processManager: pm,
      });

      mockStatus = 500;
      mockBody   = Buffer.from('Internal Server Error');
      const result = await orch.routePayload('test', 'daughter-500');

      expect(result.outcome).toBe('dropped');
      await new Promise<void>((r) => setImmediate(r));
      expect(calls).toHaveLength(0);
    });

    it('quarantineMode=sanitize is forwarded to the router correctly', async () => {
      const { pm } = makeProcessManagerSpy();

      const neuralyzed = new Promise<NeuralyzedEvent>((resolve) => {
        const orch = new SwarmOrchestrator({
          gatewayUrl:     `http://127.0.0.1:${port}`,
          quarantineMode: 'sanitize',
          processManager: pm,
          onNeuralyzed:   resolve,
        });

        mockBody = rc(1); // RC_DENY
        void orch.routePayload('dirty', 'daughter-sanitize');
      });

      const event = await neuralyzed;
      expect(event.record.mode).toBe('sanitize');
    });
  });
});
