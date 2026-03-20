/**
 * MCPTransportAdapter unit tests
 *
 * Covers:
 *   CircuitBreaker  — state machine transitions
 *   callToolText    — regression for ReferenceError bug (executeTransport → exec)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CircuitBreaker, MCPTransportAdapter } from '../../src/security/mcp-transport.js';

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

describe('CircuitBreaker', () => {
  it('starts CLOSED and allows requests', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30_000 });
    expect(() => cb.allowRequest()).not.toThrow();
    expect(cb.getState().state).toBe('CLOSED');
  });

  it('trips to OPEN after failureThreshold consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 30_000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe('OPEN');
    expect(() => cb.allowRequest()).toThrow(/Circuit breaker OPEN/);
  });

  it('resets to CLOSED on success', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeout: 30_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe('OPEN');

    cb.reset();
    expect(cb.getState().state).toBe('CLOSED');
    expect(cb.getState().failureCount).toBe(0);
    expect(() => cb.allowRequest()).not.toThrow();
  });

  it('does not trip before reaching failureThreshold', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 30_000 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().state).toBe('CLOSED');
    expect(() => cb.allowRequest()).not.toThrow();
  });

  it('recordSuccess resets failure count', () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, resetTimeout: 30_000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getState().failureCount).toBe(0);
    expect(cb.getState().state).toBe('CLOSED');
  });
});

// ---------------------------------------------------------------------------
// callToolText — regression test for ReferenceError (executeTransport → exec)
// ---------------------------------------------------------------------------

describe('MCPTransportAdapter.callToolText', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  function makeAdapter() {
    return new MCPTransportAdapter({
      command: 'npx',
      args: ['claude-flow'],
      env: {},
    });
  }

  function injectMockClient(
    adapter: MCPTransportAdapter,
    mockCallTool: (args: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>,
  ) {
    // Bypass connect() by injecting a mock client directly
    (adapter as unknown as Record<string, unknown>)['client'] = { callTool: mockCallTool };
  }

  it('returns text content without throwing ReferenceError', async () => {
    const adapter = makeAdapter();
    injectMockClient(adapter, async () => ({
      isError: false,
      content: [{ type: 'text', text: 'hello from tool' }],
    }));

    const result = await adapter.callToolText('some_tool', { key: 'value' });
    expect(result).toBe('hello from tool');
  });

  it('throws when the tool returns an error response', async () => {
    const adapter = makeAdapter();
    injectMockClient(adapter, async () => ({
      isError: true,
      content: [{ type: 'text', text: 'tool failure' }],
    }));

    await expect(adapter.callToolText('some_tool', {})).rejects.toThrow(/MCP tool error/);
  });

  it('throws when breaker is OPEN', async () => {
    const adapter = makeAdapter();
    injectMockClient(adapter, async () => ({ isError: false, content: [] }));

    // Trip the breaker
    const cb = (adapter as unknown as Record<string, unknown>)['breaker'] as CircuitBreaker;
    for (let i = 0; i < 5; i++) cb.recordFailure();

    await expect(adapter.callToolText('tool', {})).rejects.toThrow(/Circuit breaker OPEN/);
  });

  it('falls back to JSON.stringify when content is non-text', async () => {
    const adapter = makeAdapter();
    injectMockClient(adapter, async () => ({
      isError: false,
      content: [{ type: 'image', data: 'base64data' }],
    }));

    const result = await adapter.callToolText('tool', {});
    expect(typeof result).toBe('string');
    expect(result).toContain('image');
  });
});
