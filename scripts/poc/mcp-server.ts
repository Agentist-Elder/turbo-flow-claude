/**
 * Phase P5a — Motha'Ship MCP Server Wrapper
 *
 * Exposes the PoC security pipeline as MCP tools consumable by any Claude Code
 * agent or other MCP-compatible client.  Requires the PoC server to be running.
 *
 * Tools exposed:
 *   analyze_threat   — submit raw text for Gemini analysis → quarantine
 *   list_queue       — retrieve the quarantine queue (pending by default)
 *   get_stats        — cache + pipeline statistics
 *   approve_threat   — promote a quarantine entry to the blocked set
 *   discard_threat   — discard a quarantine entry
 *
 * Usage:
 *   npx tsx scripts/poc/mcp-server.ts [--server http://127.0.0.1:3000]
 *
 * Register in Claude Code (.claude/settings.json mcpServers):
 *   {
 *     "ruvbot-security": {
 *       "command": "npx",
 *       "args": ["tsx", "scripts/poc/mcp-server.ts"]
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args      = process.argv.slice(2);
const serverIdx = args.indexOf('--server');
const POC_URL   = (serverIdx >= 0 && args[serverIdx + 1])
  ? args[serverIdx + 1]!
  : 'http://127.0.0.1:3000';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function get(path: string): Promise<unknown> {
  const res = await fetch(`${POC_URL}${path}`);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

async function post(path: string, body?: string, contentType = 'application/json'): Promise<unknown> {
  const res = await fetch(`${POC_URL}${path}`, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': contentType } : {},
    body,
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name:    'ruvbot-security',
  version: '0.5.0',
});

// ── analyze_threat ────────────────────────────────────────────────────────

server.tool(
  'analyze_threat',
  'Submit raw text to the RuvBot security pipeline. Runs through the SHA-256 ' +
  'cache (Layer 1.5) and Gemini LLM Surgeon (Layer 2). Returns the disposition: ' +
  'blocked, cached_blocked, or quarantined (with attack classification).',
  {
    text: z.string().min(1).describe('Raw attack text or payload to analyze'),
  },
  async ({ text }) => {
    const result = await post('/poc/submit', text, 'application/octet-stream');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── list_queue ────────────────────────────────────────────────────────────

server.tool(
  'list_queue',
  'Retrieve the quarantine queue. Returns all entries with their attack type, ' +
  'confidence score, status, and surgeon source.',
  {
    status: z.enum(['pending', 'approved', 'discarded', 'all'])
      .default('pending')
      .describe('Filter by entry status (default: pending)'),
  },
  async ({ status }) => {
    const queue = await get('/poc/queue') as Array<Record<string, unknown>>;
    const filtered = status === 'all'
      ? queue
      : queue.filter(e => e['status'] === status);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(filtered, null, 2) }],
    };
  },
);

// ── get_stats ─────────────────────────────────────────────────────────────

server.tool(
  'get_stats',
  'Retrieve pipeline statistics: SHA-256 cache hit rate, quarantine queue counts, ' +
  'and approved-attacks set size.',
  {},
  async () => {
    const stats = await get('/poc/stats');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }],
    };
  },
);

// ── approve_threat ────────────────────────────────────────────────────────

server.tool(
  'approve_threat',
  'Approve a quarantine entry. Marks it as approved and adds its SHA-256 ' +
  'fingerprint to the in-memory blocked set so future identical payloads ' +
  'are blocked at Layer 0 (post-patch block). Also flushes the cache.',
  {
    id: z.string().uuid().describe('Quarantine entry UUID to approve'),
  },
  async ({ id }) => {
    const result = await post(`/poc/promote/${id}`);
    // Also flush cache so the next submission hits Layer 0 instead of Layer 1.5
    await post('/poc/flush').catch(() => { /* non-fatal */ });
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── discard_threat ────────────────────────────────────────────────────────

server.tool(
  'discard_threat',
  'Discard a quarantine entry. Marks it as discarded without adding to the ' +
  'blocked set — use when the Surgeon misclassified a benign payload.',
  {
    id: z.string().uuid().describe('Quarantine entry UUID to discard'),
  },
  async ({ id }) => {
    const result = await post(`/poc/discard/${id}`);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is reserved for MCP protocol messages
  process.stderr.write(
    `[ruvbot-security MCP] connected — poc-server: ${POC_URL}\n`,
  );
}

main().catch(err => {
  process.stderr.write(`[ruvbot-security MCP] fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
