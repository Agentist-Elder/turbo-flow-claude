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
import type { MCPToolCaller } from './live-mcp-client.js';

// ── Config ──────────────────────────────────────────────────────────

interface MCPTransportConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

// ── Transport Adapter ───────────────────────────────────────────────

export class MCPTransportAdapter {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private config: MCPTransportConfig;

  constructor(config: MCPTransportConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...process.env, ...this.config.env } as Record<string, string>,
    });
    this.client = new Client({ name: 'ruvbot-swarm', version: '1.0.0' });
    await this.client.connect(this.transport);
  }

  /**
   * Calls an MCP tool by short name (e.g. "aidefence_scan").
   * Prepends the "mcp__claude-flow__" prefix for the full tool name.
   *
   * NO try/catch — errors propagate for L3 fail-CLOSED safety.
   */
  callTool: MCPToolCaller = async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> => {
    if (!this.client) {
      throw new Error('MCPTransportAdapter: client not connected');
    }

    const fullName = `mcp__claude-flow__${toolName}`;
    const response = await this.client.callTool({ name: fullName, arguments: args });

    if (response.isError) {
      throw new Error(`MCP tool error from '${fullName}': ${JSON.stringify(response.content)}`);
    }

    const content = response.content as Array<{ type: string; text?: string }>;
    if (content.length > 0 && content[0].type === 'text' && typeof content[0].text === 'string') {
      return JSON.parse(content[0].text);
    }

    throw new Error(`Unexpected response format from '${fullName}': ${JSON.stringify(response)}`);
  };

  async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
  }
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Reads .mcp.json from cwd, extracts claude-flow server config,
 * creates and connects the transport adapter.
 */
export async function createClaudeFlowTransport(): Promise<MCPTransportAdapter> {
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
