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
import type { MCPToolCaller } from './live-mcp-client.js';
export interface MCPTransportConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
    /** Override the MCP SDK's default 60s request timeout (ms). Use for slow upstream APIs. */
    requestTimeoutMs?: number;
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
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private lastFailureTime;
    private config;
    constructor(config?: CircuitBreakerConfig);
    /** Check if a call is allowed. Throws if breaker is OPEN and reset timeout hasn't elapsed. */
    allowRequest(): void;
    /** Record a successful call. Resets the breaker to CLOSED. */
    recordSuccess(): void;
    /** Record a failed call. May trip the breaker to OPEN. */
    recordFailure(): void;
    getState(): {
        state: string;
        failureCount: number;
    };
    /** Force-reset the breaker (e.g. after a successful reconnect). */
    reset(): void;
}
export declare class MCPTransportAdapter {
    private client;
    private transport;
    private config;
    private breaker;
    private retryConfig;
    private reconnecting;
    constructor(config: MCPTransportConfig, breakerConfig?: CircuitBreakerConfig, retryConfig?: RetryConfig);
    connect(timeoutMs?: number): Promise<void>;
    /**
     * Tear down and re-establish the MCP connection.
     * Coalesces concurrent reconnect attempts into one.
     */
    reconnect(): Promise<void>;
    /**
     * Execute a function with exponential backoff retries.
     * IMPORTANT: Only for non-L3 calls. L3 must never be retried.
     */
    private withRetry;
    /**
     * Calls an MCP tool by name (e.g. "aidefence_scan").
     *
     * Flow: circuit breaker check → call → parse → record success/failure.
     * Errors still propagate to the coordinator for fail-open/fail-CLOSED.
     */
    callTool: MCPToolCaller;
    /**
     * Calls an MCP tool and returns raw text content without JSON.parse.
     * Use for tools that return plain text (e.g. Playwright browser_snapshot).
     */
    callToolText: (toolName: string, args: Record<string, unknown>) => Promise<string>;
    /**
     * Calls an MCP tool with retry logic for transient failures.
     * Use this for L1/L2/L4 (fail-open layers). NEVER use for L3.
     */
    callToolWithRetry: MCPToolCaller;
    /** Expose breaker state for health checks and monitoring. */
    getCircuitBreakerState(): {
        state: string;
        failureCount: number;
    };
    disconnect(): Promise<void>;
}
/**
 * Reads .mcp.json from cwd, extracts claude-flow server config,
 * creates and connects the transport adapter.
 */
export declare function createClaudeFlowTransport(breakerConfig?: CircuitBreakerConfig, retryConfig?: RetryConfig): Promise<MCPTransportAdapter>;
