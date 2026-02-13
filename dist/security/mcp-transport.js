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
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'fs/promises';
import { join } from 'path';
// ── Transport Adapter ───────────────────────────────────────────────
export class MCPTransportAdapter {
    client = null;
    transport = null;
    config;
    constructor(config) {
        this.config = config;
    }
    async connect() {
        this.transport = new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            env: { ...process.env, ...this.config.env },
        });
        this.client = new Client({ name: 'ruvbot-swarm', version: '1.0.0' });
        await this.client.connect(this.transport);
    }
    /**
     * Calls an MCP tool by name (e.g. "aidefence_scan").
     *
     * NO try/catch — errors propagate for L3 fail-CLOSED safety.
     */
    callTool = async (toolName, args) => {
        if (!this.client) {
            throw new Error('MCPTransportAdapter: client not connected');
        }
        const response = await this.client.callTool({ name: toolName, arguments: args });
        if (response.isError) {
            throw new Error(`MCP tool error from '${toolName}': ${JSON.stringify(response.content)}`);
        }
        const content = response.content;
        if (content.length > 0 && content[0].type === 'text' && typeof content[0].text === 'string') {
            return JSON.parse(content[0].text);
        }
        throw new Error(`Unexpected response format from '${toolName}': ${JSON.stringify(response)}`);
    };
    async disconnect() {
        try {
            await this.client?.close();
        }
        finally {
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
export async function createClaudeFlowTransport() {
    const configPath = join(process.cwd(), '.mcp.json');
    const raw = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const serverConfig = parsed.mcpServers?.['claude-flow'];
    if (!serverConfig) {
        throw new Error('Missing "claude-flow" in .mcp.json mcpServers');
    }
    const adapter = new MCPTransportAdapter({
        command: serverConfig.command,
        args: serverConfig.args ?? [],
        env: serverConfig.env ?? {},
    });
    await adapter.connect();
    return adapter;
}
