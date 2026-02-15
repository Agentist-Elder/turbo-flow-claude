/**
 * Tests for MCPTransportAdapter Phase 9: Circuit Breaker + Retry
 *
 * These are unit tests that mock the MCP Client — no live server needed.
 * Grounded in GTIG Feb 2026 findings:
 *   - Circuit breaker: defends against Hexstrike-style cascading MCP abuse
 *   - Retry: resilience for transient failures on non-L3 layers
 *   - L3 never retried: fail-CLOSED semantics preserved
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, MCPTransportAdapter } from '../../src/security/mcp-transport.js';

// ── Circuit Breaker Unit Tests ──────────────────────────────────────

describe('CircuitBreaker', () => {
  it('starts in CLOSED state and allows requests', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
    expect(() => cb.allowRequest()).not.toThrow();
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('trips to OPEN after failureThreshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(() => cb.allowRequest()).not.toThrow(); // 2 < 3
    cb.recordFailure();
    expect(() => cb.allowRequest()).toThrow(/Circuit breaker OPEN/);
    expect(cb.getState().state).toBe('OPEN');
  });

  it('resets failure count on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getState().failureCount).toBe(0);
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('transitions to HALF_OPEN after resetTimeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });
    cb.recordFailure();
    cb.recordFailure();
    expect(() => cb.allowRequest()).toThrow(/Circuit breaker OPEN/);

    await new Promise((r) => setTimeout(r, 60));
    expect(() => cb.allowRequest()).not.toThrow(); // Now HALF_OPEN, probe allowed
  });

  it('re-opens if probe fails in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });
    cb.recordFailure();
    cb.recordFailure();

    await new Promise((r) => setTimeout(r, 60));
    cb.allowRequest(); // HALF_OPEN
    cb.recordFailure(); // Probe fails

    expect(cb.getState().state).toBe('OPEN');
  });

  it('closes if probe succeeds in HALF_OPEN', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 50 });
    cb.recordFailure();
    cb.recordFailure();

    await new Promise((r) => setTimeout(r, 60));
    cb.allowRequest(); // HALF_OPEN
    cb.recordSuccess(); // Probe succeeds

    expect(cb.getState().state).toBe('CLOSED');
    expect(cb.getState().failureCount).toBe(0);
  });

  it('reset() force-closes the breaker', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 60000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe('OPEN');
    cb.reset();
    expect(cb.getState().state).toBe('CLOSED');
  });
});

// ── MCPTransportAdapter Circuit Breaker Integration ─────────────────

describe('MCPTransportAdapter (circuit breaker)', () => {
  let adapter: MCPTransportAdapter;

  beforeEach(() => {
    adapter = new MCPTransportAdapter(
      { command: 'echo', args: [], env: {} },
      { failureThreshold: 3, resetTimeout: 1000 },
      { maxRetries: 1, baseDelay: 10, maxDelay: 50 },
    );
  });

  it('throws when calling without connect (client not set)', async () => {
    await expect(adapter.callTool('test', {})).rejects.toThrow('client not connected');
  });

  it('exposes circuit breaker state for health checks', () => {
    const state = adapter.getCircuitBreakerState();
    expect(state.state).toBe('CLOSED');
    expect(state.failureCount).toBe(0);
  });
});

// ── Retry Logic ─────────────────────────────────────────────────────

describe('MCPTransportAdapter (retry via callToolWithRetry)', () => {
  it('callToolWithRetry is exposed as MCPToolCaller', () => {
    const adapter = new MCPTransportAdapter(
      { command: 'echo', args: [], env: {} },
      { failureThreshold: 10, resetTimeout: 1000 },
      { maxRetries: 2, baseDelay: 10, maxDelay: 50 },
    );
    expect(typeof adapter.callToolWithRetry).toBe('function');
  });

  it('callToolWithRetry fails after retries exhausted when not connected', async () => {
    const adapter = new MCPTransportAdapter(
      { command: 'echo', args: [], env: {} },
      { failureThreshold: 10, resetTimeout: 1000 },
      { maxRetries: 1, baseDelay: 10, maxDelay: 50 },
    );
    // Without connecting, each attempt should fail with 'client not connected'
    await expect(adapter.callToolWithRetry('test', {})).rejects.toThrow('client not connected');
  });
});
