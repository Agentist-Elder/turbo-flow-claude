/**
 * RuvBot Swarm - MCP Transport Bridge (Phase 8 → Phase 9: Hardened)
 *
 * Replaces the firstFlightLive() placeholder with a real MCP transport
 * using @modelcontextprotocol/sdk. Spawns the claude-flow MCP server
 * via StdioClientTransport and bridges tool calls through it.
 *
 * Phase 9 additions (grounded in GTIG Feb 2026 report):
 *   - Circuit breaker: Trips after repeated failures to halt Hexstrike-style
 *     automated exploitation cascades via compromised MCP servers.
 *   - Reconnect: Transparent reconnection on transport drop so transient
 *     network/process failures don't permanently kill the pipeline.
 *   - withRetry: Exponential backoff for transient errors on non-L3 layers.
 *     L3 calls are NEVER retried — first failure = BLOCK (fail-CLOSED).
 *
 * Error handling policy (unchanged from Phase 8):
 *   Errors still propagate to the coordinator for fail-open/fail-CLOSED.
 *   The circuit breaker adds a layer BEFORE the coordinator sees errors:
 *   when tripped, ALL calls throw immediately without hitting the server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { MCPToolCaller } from './live-mcp-client.js';

// ── Config ──────────────────────────────────────────────────────────

export interface MCPTransportConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the breaker trips. */
  failureThreshold: number;
  /** Milliseconds to wait in OPEN state before attempting half-open probe. */
  resetTimeout: number;
}

export interface RetryConfig {
  /** Maximum number of retry attempts (0 = no retries). */
  maxRetries: number;
  /** Base delay in ms for exponential backoff. */
  baseDelay: number;
  /** Maximum delay cap in ms. */
  maxDelay: number;
}

const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeout: 30_000,
};

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  baseDelay: 200,
  maxDelay: 2_000,
};

// ── Circuit Breaker ─────────────────────────────────────────────────

enum BreakerState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export class CircuitBreaker {
  private state = BreakerState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER) {
    this.config = config;
  }

  /** Check if a call is allowed. Throws if breaker is OPEN and reset timeout hasn't elapsed. */
  allowRequest(): void {
    if (this.state === BreakerState.CLOSED) return;

    if (this.state === BreakerState.OPEN) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeout) {
        this.state = BreakerState.HALF_OPEN;
        return; // Allow one probe request
      }
      throw new Error(
        `Circuit breaker OPEN: ${this.failureCount} consecutive failures. ` +
        `Resets in ${Math.ceil((this.config.resetTimeout - elapsed) / 1000)}s.`,
      );
    }
    // HALF_OPEN: allow the probe through
  }

  /** Record a successful call. Resets the breaker to CLOSED. */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = BreakerState.CLOSED;
  }

  /** Record a failed call. May trip the breaker to OPEN. */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === BreakerState.HALF_OPEN) {
      // Probe failed — re-open immediately
      this.state = BreakerState.OPEN;
      return;
    }

    if (this.failureCount >= this.config.failureThreshold) {
      this.state = BreakerState.OPEN;
      console.error(
        `[MCPTransport] Circuit breaker TRIPPED after ${this.failureCount} failures. ` +
        `All MCP calls will be blocked for ${this.config.resetTimeout / 1000}s.`,
      );
    }
  }

  getState(): { state: string; failureCount: number } {
    return { state: this.state, failureCount: this.failureCount };
  }

  /** Force-reset the breaker (e.g. after a successful reconnect). */
  reset(): void {
    this.failureCount = 0;
    this.state = BreakerState.CLOSED;
  }
}

// ── Transport Adapter ───────────────────────────────────────────────

export class MCPTransportAdapter {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private config: MCPTransportConfig;
  private breaker: CircuitBreaker;
  private retryConfig: RetryConfig;
  private reconnecting: Promise<void> | null = null;

  constructor(
    config: MCPTransportConfig,
    breakerConfig?: CircuitBreakerConfig,
    retryConfig?: RetryConfig,
  ) {
    this.config = config;
    this.breaker = new CircuitBreaker(breakerConfig);
    this.retryConfig = retryConfig ?? DEFAULT_RETRY;
  }

  async connect(timeoutMs = 10_000): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    });
    this.client = new Client({ name: 'ruvbot-swarm', version: '1.0.0' });

    const connectPromise = this.client.connect(this.transport);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(
        `MCP connection timed out after ${timeoutMs}ms. Is the claude-flow server running?`,
      )), timeoutMs),
    );

    await Promise.race([connectPromise, timeoutPromise]);
  }

  /**
   * Tear down and re-establish the MCP connection.
   * Coalesces concurrent reconnect attempts into one.
   */
  async reconnect(): Promise<void> {
    if (this.reconnecting) return this.reconnecting;

    this.reconnecting = (async () => {
      console.warn('[MCPTransport] Reconnecting...');
      try {
        await this.client?.close();
      } catch { /* ignore close errors during reconnect */ }

      this.client = null;
      this.transport = null;
      await this.connect();
      this.breaker.reset();
      console.warn('[MCPTransport] Reconnected successfully.');
    })();

    try {
      await this.reconnecting;
    } finally {
      this.reconnecting = null;
    }
  }

  /**
   * Execute a function with exponential backoff retries.
   * IMPORTANT: Only for non-L3 calls. L3 must never be retried.
   */
  private async withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          const delay = Math.min(
            this.retryConfig.baseDelay * 2 ** attempt,
            this.retryConfig.maxDelay,
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Calls an MCP tool by name (e.g. "aidefence_scan").
   *
   * Flow: circuit breaker check → call → parse → record success/failure.
   * Errors still propagate to the coordinator for fail-open/fail-CLOSED.
   */
  callTool: MCPToolCaller = async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    this.breaker.allowRequest(); // Throws if breaker is OPEN

    if (!this.client) {
      throw new Error('MCPTransportAdapter: client not connected');
    }

    const exec = async (): Promise<unknown> => {
      const response = await this.client!.callTool({ name: toolName, arguments: args });

      if (response.isError) {
        throw new Error(`MCP tool error from '${toolName}': ${JSON.stringify(response.content)}`);
      }

      const content = response.content as Array<{ type: string; text?: string }>;
      if (content.length > 0 && content[0].type === 'text' && typeof content[0].text === 'string') {
        return JSON.parse(content[0].text);
      }

      throw new Error(`Unexpected response format from '${toolName}': ${JSON.stringify(response)}`);
    };

    try {
      const result = await exec();
      this.breaker.recordSuccess();
      return result;
    } catch (err) {
      this.breaker.recordFailure();
      throw err;
    }
  };

  /**
   * Calls an MCP tool with retry logic for transient failures.
   * Use this for L1/L2/L4 (fail-open layers). NEVER use for L3.
   */
  callToolWithRetry: MCPToolCaller = async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    return this.withRetry(
      () => this.callTool(toolName, args),
      this.retryConfig.maxRetries,
    );
  };

  /** Expose breaker state for health checks and monitoring. */
  getCircuitBreakerState(): { state: string; failureCount: number } {
    return this.breaker.getState();
  }

  async disconnect(): Promise<void> {
    try {
      await this.client?.close();
    } finally {
      this.client = null;
      this.transport = null;
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Reads .mcp.json from cwd, extracts claude-flow server config,
 * creates and connects the transport adapter.
 */
export async function createClaudeFlowTransport(
  breakerConfig?: CircuitBreakerConfig,
  retryConfig?: RetryConfig,
): Promise<MCPTransportAdapter> {
  const configPath = join(process.cwd(), '.mcp.json');
  const raw = await readFile(configPath, 'utf-8');
  const parsed = JSON.parse(raw);

  const serverConfig = parsed.mcpServers?.['claude-flow'];
  if (!serverConfig) {
    throw new Error('Missing "claude-flow" in .mcp.json mcpServers');
  }

  const adapter = new MCPTransportAdapter(
    {
      command: serverConfig.command,
      args: serverConfig.args ?? [],
      env: serverConfig.env ?? {},
    },
    breakerConfig,
    retryConfig,
  );
  await adapter.connect();
  return adapter;
}
