/**
 * RVF Witness Chain + Decision Ledger Test Suite
 * Phase 12a: RVF-Native Bunker — tamper evidence via SHAKE-256 witness chains.
 *
 * Validates:
 *   1. contentHash() produces content-addressed keys
 *   2. dispatch() writes to decision_ledger (content-addressed)
 *   3. dispatch() records RVF PROVENANCE witness entries
 *   4. StubRVFBridge captures witness log for test assertions
 *   5. Chain linking: lastMessageByRole forms append-only chain
 *   6. RVF witness failure does NOT crash dispatch (fire-and-forget)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  SwarmOrchestrator,
  StubRVFBridge,
  WitnessType,
  contentHash,
  type SwarmMessage,
  type AgentRole,
  type IMCPBridge,
  type IRVFBridge,
} from '../../src/swarm/orchestrator.js';
import {
  AIDefenceCoordinator,
  MockMCPClient,
} from '../../src/security/coordinator.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMessage(
  from: AgentRole = 'architect',
  to: AgentRole = 'worker',
  content = 'Design the SecureLogger utility',
): SwarmMessage {
  return {
    id: randomUUID(),
    from,
    to,
    content,
    timestamp: Date.now(),
  };
}

function makeOrchestrator(
  bridgeOverrides: Partial<IMCPBridge> = {},
  configOverrides: Record<string, unknown> = {},
  rvfBridge?: IRVFBridge,
) {
  const coordinator = new AIDefenceCoordinator({}, new MockMCPClient());
  const bridge: IMCPBridge = {
    spawnAgent: vi.fn(async (c) => c.agentId ?? randomUUID()),
    terminateAgent: vi.fn(async () => {}),
    storeMemory: vi.fn(async () => {}),
    ...bridgeOverrides,
  };
  const rvf = rvfBridge ?? new StubRVFBridge();
  const orch = new SwarmOrchestrator(coordinator, configOverrides, bridge, rvf);
  return { orch, bridge, rvf: rvf as StubRVFBridge };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('Content Hash', () => {
  it('produces a 64-char hex string', () => {
    expect(contentHash('hello')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('same content = same hash (deterministic)', () => {
    expect(contentHash('test')).toBe(contentHash('test'));
  });

  it('different content = different hash', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

describe('Decision Ledger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('writes content-addressed entry to decision_ledger namespace', async () => {
    const storeMemory = vi.fn(async () => {});
    const { orch } = makeOrchestrator({ storeMemory });
    const msg = makeMessage();

    await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    const ledgerCall = storeMemory.mock.calls.find(
      (call: unknown[]) => call[2] === 'decision_ledger',
    );
    expect(ledgerCall).toBeDefined();
    expect(ledgerCall![0]).toMatch(/^ledger:[a-f0-9]{64}$/);
  });

  it('ledger entry contains messageId, from, to, contentHash, verdict', async () => {
    const storeMemory = vi.fn(async () => {});
    const { orch } = makeOrchestrator({ storeMemory });
    const msg = makeMessage('architect', 'worker', 'Build the parser');

    await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    const ledgerCall = storeMemory.mock.calls.find(
      (call: unknown[]) => call[2] === 'decision_ledger',
    );
    const entry = JSON.parse(ledgerCall![1] as string);
    expect(entry.messageId).toBe(msg.id);
    expect(entry.from).toBe('architect');
    expect(entry.to).toBe('worker');
    expect(entry.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.verdict).toBe('SAFE');
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('HandoffRecord includes contentHash field', async () => {
    const { orch } = makeOrchestrator();
    const msg = makeMessage();
    const record = await orch.dispatch(msg);
    expect(record.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('enableLedger=false skips ledger writes', async () => {
    const storeMemory = vi.fn(async () => {});
    const { orch } = makeOrchestrator({ storeMemory }, { enableLedger: false });
    const msg = makeMessage();

    await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    const ledgerCalls = storeMemory.mock.calls.filter(
      (call: unknown[]) => call[2] === 'decision_ledger',
    );
    expect(ledgerCalls).toHaveLength(0);
  });

  it('ledger failure does NOT crash dispatch', async () => {
    const storeMemory = vi.fn(async (_key: string, _val: string, ns?: string) => {
      if (ns === 'decision_ledger') throw new Error('Ledger DB down');
    });
    const { orch } = makeOrchestrator({ storeMemory });
    const msg = makeMessage();

    const record = await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));
    expect(record.deliveredContent.length).toBeGreaterThan(0);
  });
});

describe('RVF Witness Chain', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('records PROVENANCE witness entry on dispatch', async () => {
    const { orch, rvf } = makeOrchestrator();
    const msg = makeMessage('architect', 'worker', 'Design task');

    await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    expect(rvf.witnessLog).toHaveLength(1);
    expect(rvf.witnessLog[0].witnessType).toBe(WitnessType.PROVENANCE);
    expect(rvf.witnessLog[0].actionHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('witness metadata contains messageId, from, to, verdict', async () => {
    const { orch, rvf } = makeOrchestrator();
    const msg = makeMessage('worker', 'architect', 'Implementation complete');

    await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    const meta = rvf.witnessLog[0].metadata;
    expect(meta.messageId).toBe(msg.id);
    expect(meta.from).toBe('worker');
    expect(meta.to).toBe('architect');
    expect(meta.verdict).toBe('SAFE');
    expect(meta.timestamp).toBeGreaterThan(0);
  });

  it('witness actionHash matches content hash of delivered content', async () => {
    const { orch, rvf } = makeOrchestrator();
    const msg = makeMessage('architect', 'worker', 'Specific content');

    const record = await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    expect(rvf.witnessLog[0].actionHash).toBe(record.contentHash);
  });

  it('sets witnessRecorded=true on HandoffRecord after recording', async () => {
    const { orch } = makeOrchestrator();
    const msg = makeMessage();

    const record = await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    expect(record.witnessRecorded).toBe(true);
  });

  it('multiple dispatches create multiple witness entries', async () => {
    const { orch, rvf } = makeOrchestrator();

    await orch.dispatch(makeMessage('architect', 'worker', 'Task 1'));
    await orch.dispatch(makeMessage('worker', 'architect', 'Result 1'));
    await orch.dispatch(makeMessage('architect', 'reviewer', 'Review this'));
    await new Promise(r => setTimeout(r, 10));

    expect(rvf.witnessLog).toHaveLength(3);
  });

  it('RVF witness failure does NOT crash dispatch', async () => {
    const failingRVF: IRVFBridge = {
      recordWitness: async () => { throw new Error('RVF store unavailable'); },
      getStatus: async () => ({ vectorCount: 0, segmentCount: 0 }),
    };
    const { orch } = makeOrchestrator({}, {}, failingRVF);
    const msg = makeMessage();

    const record = await orch.dispatch(msg);
    await new Promise(r => setTimeout(r, 10));

    expect(record.deliveredContent.length).toBeGreaterThan(0);
  });

  it('StubRVFBridge.getStatus reports witness count', async () => {
    const { orch, rvf } = makeOrchestrator();

    await orch.dispatch(makeMessage('architect', 'worker', 'A'));
    await orch.dispatch(makeMessage('worker', 'architect', 'B'));
    await new Promise(r => setTimeout(r, 10));

    const status = await rvf.getStatus();
    expect(status.vectorCount).toBe(2);
  });
});

describe('Chain Linking', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('getLastMessageId tracks the latest message per role', async () => {
    const { orch } = makeOrchestrator();
    const msg1 = makeMessage('architect', 'worker', 'First task');
    const msg2 = makeMessage('architect', 'worker', 'Second task');

    await orch.dispatch(msg1);
    expect(orch.getLastMessageId('architect')).toBe(msg1.id);

    await orch.dispatch(msg2);
    expect(orch.getLastMessageId('architect')).toBe(msg2.id);
  });

  it('different roles have independent chains', async () => {
    const { orch } = makeOrchestrator();
    const archMsg = makeMessage('architect', 'worker', 'Architect says');
    const workerMsg = makeMessage('worker', 'architect', 'Worker replies');

    await orch.dispatch(archMsg);
    await orch.dispatch(workerMsg);

    expect(orch.getLastMessageId('architect')).toBe(archMsg.id);
    expect(orch.getLastMessageId('worker')).toBe(workerMsg.id);
  });
});
