/**
 * RuvBot Swarm - MCP Transport Bridge (Phase 8)
 *
 * Replaces the firstFlightLive() placeholder with a real MCP transport
 * using @modelcontextprotocol/sdk. Spawns the claude-flow MCP server
 * via StdioClientTransport and bridges tool calls through it.
 *
 * Error handling policy:
 *   callTool does NOT catch errors — they propagate to the coordinator
 *   which enforces fail-CLOSED on L3 and fail-open on L1/L2/L4.
 */
import type { MCPToolCaller } from './live-mcp-client.js';
interface MCPTransportConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}
export declare class MCPTransportAdapter {
    private client;
    private transport;
    private config;
    constructor(config: MCPTransportConfig);
    connect(): Promise<void>;
    /**
     * Calls an MCP tool by name (e.g. "aidefence_scan").
     *
     * NO try/catch — errors propagate for L3 fail-CLOSED safety.
     */
    callTool: MCPToolCaller;
    disconnect(): Promise<void>;
}
/**
 * Reads .mcp.json from cwd, extracts claude-flow server config,
 * creates and connects the transport adapter.
 */
export declare function createClaudeFlowTransport(): Promise<MCPTransportAdapter>;
export {};
