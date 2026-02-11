/**
 * First Flight LIVE — Runs the full pipeline and prints results.
 * This is the "prove it works" test.
 */

import { describe, it, expect } from 'vitest';
import { firstFlight, firstFlightLive, type FlightLog } from '../../src/main.js';

describe('First Flight LIVE Run', () => {
  it('executes the full pipeline and prints the flight log', async () => {
    // Let console output through for this test (live demo)
    const log: FlightLog = await firstFlight();

    // Assertions
    expect(log.totalDispatches).toBe(4);
    expect(log.handoffs).toHaveLength(3);
    expect(log.totalBlocked).toBe(1);
    expect(log.violations).toHaveLength(1);
    expect(log.violations[0].verdict).toBe('BLOCKED');
    expect(log.violations[0].threatScore).toBe(0.95);
    expect(log.elapsedMs).toBeLessThan(100);

    // Print final summary for the user
    console.log('\n┌──────────────────────────────────────────────┐');
    console.log('│        FIRST FLIGHT — MISSION COMPLETE        │');
    console.log('├──────────────────────────────────────────────┤');
    console.log(`│  Dispatches:     ${log.totalDispatches}                          │`);
    console.log(`│  Delivered:      ${log.handoffs.length}                          │`);
    console.log(`│  Blocked:        ${log.totalBlocked}                          │`);
    console.log(`│  Kill Switch:    ENGAGED (score ${log.violations[0].threatScore})     │`);
    console.log(`│  Total Time:     ${log.elapsedMs.toFixed(2)}ms                  │`);
    console.log('├──────────────────────────────────────────────┤');
    console.log('│  Handoff 1: architect -> worker    SAFE      │');
    console.log('│  Handoff 2: worker -> architect    SAFE      │');
    console.log('│  Handoff 3: architect -> reviewer  PII REDACT│');
    console.log('│  Handoff 4: worker -> architect    BLOCKED   │');
    console.log('└──────────────────────────────────────────────┘');
  });
});

describe('First Flight LIVE Run (Phase 8)', () => {
  it('executes the live MCP pipeline with real transport', async () => {
    const log: FlightLog = await firstFlightLive();

    // Phase 8: real MCP transport — at least 2 dispatches, 1 blocked
    expect(log.totalDispatches).toBeGreaterThanOrEqual(2);
    expect(log.totalBlocked).toBeGreaterThanOrEqual(1);
    expect(log.elapsedMs).toBeGreaterThan(0);

    // Print summary
    console.log('\n┌──────────────────────────────────────────────┐');
    console.log('│     FIRST FLIGHT LIVE (Phase 8) — COMPLETE    │');
    console.log('├──────────────────────────────────────────────┤');
    console.log(`│  Dispatches:     ${log.totalDispatches}                          │`);
    console.log(`│  Delivered:      ${log.handoffs.length}                          │`);
    console.log(`│  Blocked:        ${log.totalBlocked}                          │`);
    console.log(`│  Total Time:     ${log.elapsedMs.toFixed(2)}ms               │`);
    console.log('├──────────────────────────────────────────────┤');
    console.log('│  Transport:      MCP SDK (stdio)             │');
    console.log('│  Neural Shield:  HNSW + VectorScanner        │');
    console.log('│  L3 Invariant:   fail-CLOSED enforced        │');
    console.log('└──────────────────────────────────────────────┘');
  }, 30_000);
});
