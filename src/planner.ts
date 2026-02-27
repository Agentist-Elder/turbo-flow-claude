/**
 * RuvBot Swarm - SPARC Planner (Local Architecture & Pseudocode)
 * * Stripped of external OSINT/TSA logic for lean local execution.
 * * URL/External source constraints disabled for internal workspace file reading.
 * * Dynamic output and context paths to prevent accidental overwrites.
 */

import { randomUUID } from 'crypto';
import { readFile, writeFile, mkdir, unlink, copyFile, readdir, access } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { performance } from 'perf_hooks';
import { AIDefenceCoordinator, ThreatLevel } from './security/coordinator.js';
import { NeuralLiveMCPClient, type MCPToolCaller } from './security/live-mcp-client.js';
import { MCPTransportAdapter, createClaudeFlowTransport } from './security/mcp-transport.js';
import { VectorScanner } from './security/vector-scanner.js';
import { SessionThreatState, estimateLambda, applyConsensusVoting } from './security/min-cut-gate.js';
import { localMinCutLambda } from './security/stoer-wagner.js';
import { decontaminate, type AuditFn } from './security/semantic-chunker.js';
import {
  SwarmOrchestrator,
  SecurityViolationError,
  WitnessType,
  type SwarmMessage,
  type HandoffRecord,
  type IMCPBridge,
  type IRVFBridge,
} from './swarm/orchestrator.js';

type HFExtractor = (text: string, opts: Record<string, unknown>) => Promise<{ data: Float32Array }>;

export interface FlightLog {
  handoffs: HandoffRecord[];
  violations: Array<{
    messageId: string;
    from: string;
    to: string;
    blockReason: string;
    threatScore: number;
    verdict: ThreatLevel;
    timestamp: number;
  }>;
  totalDispatches: number;
  totalBlocked: number;
  elapsedMs: number;
}

export class RecordingMCPBridge implements IMCPBridge {
  public readonly auditLog: Array<{ key: string; value: string; namespace?: string }> = [];
  async spawnAgent(config: { agentType: string; agentId?: string }): Promise<string> { return config.agentId ?? randomUUID(); }
  async terminateAgent(): Promise<void> { }
  async storeMemory(key: string, value: string, namespace?: string): Promise<void> { this.auditLog.push({ key, value, namespace }); }
}

export function createMessage(from: SwarmMessage['from'], to: SwarmMessage['to'], content: string, metadata?: Record<string, unknown>): SwarmMessage {
  return { id: randomUUID(), from, to, content, timestamp: Date.now(), metadata };
}

function parseGoalArgs(): { goal: string | null; allowSecurityResearch: boolean; outputFile: string; contextFile: string | null } {
  const args = process.argv.slice(2);
  let goal: string | null = null;
  let allowSecurityResearch = false;
  let outputFile = '/workspaces/turbo-flow-claude/docs/research/SPARC-Output.md'; 
  let contextFile: string | null = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--goal' && args[i + 1]) goal = args[i + 1];
    if (args[i] === '--allow-security-research') allowSecurityResearch = true;
    if (args[i] === '--output' && args[i + 1]) outputFile = args[i + 1];
    if (args[i] === '--context' && args[i + 1]) contextFile = args[i + 1];
  }
  return { goal, allowSecurityResearch, outputFile, contextFile };
}

function buildSecretScrubber(): (text: string) => string {
  const secrets: string[] = [];
  const envKeys = ['GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
  for (const key of envKeys) {
    const val = process.env[key];
    if (val && val.length >= 8) secrets.push(val);
  }
  return (text: string): string => {
    let scrubbed = text;
    for (const secret of secrets) {
      while (scrubbed.includes(secret)) scrubbed = scrubbed.split(secret).join('[REDACTED]');
    }
    return scrubbed;
  };
}

export class LiveRVFBridge implements IRVFBridge {
  private adapter: MCPTransportAdapter;
  private storeId: string | null = null;
  private dimensions = 128;
  private scrub: (text: string) => string;

  constructor(adapter: MCPTransportAdapter, scrubber?: (text: string) => string) {
    this.adapter = adapter;
    this.scrub = scrubber ?? ((t) => t);
  }

  async initialize(storePath: string): Promise<void> {
    const result = await this.adapter.callTool('rvf_create_store', { path: storePath, dimensions: this.dimensions, metric: 'cosine' }) as { storeId: string };
    this.storeId = result.storeId;
  }

  async recordWitness(entry: { witnessType: WitnessType; actionHash: string; metadata: Record<string, unknown>; }): Promise<void> {
    if (!this.storeId) return;
    const vector = this.hashToVector(entry.actionHash);
    const cleanMeta: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(entry.metadata)) cleanMeta[k] = typeof v === 'string' ? this.scrub(v) : v;
    await this.adapter.callTool('rvf_ingest', {
      storeId: this.storeId,
      entries: [{ id: `witness_${Date.now()}_${entry.witnessType}`, vector, metadata: { witnessType: entry.witnessType, actionHash: entry.actionHash, ...cleanMeta } }],
    });
  }

  async getStatus(): Promise<{ vectorCount: number; segmentCount: number }> {
    if (!this.storeId) return { vectorCount: 0, segmentCount: 0 };
    const result = await this.adapter.callTool('rvf_status', { storeId: this.storeId }) as { totalVectors: number };
    return { vectorCount: result.totalVectors, segmentCount: 0 };
  }

  private hashToVector(hash: string): number[] {
    const vec = new Array(this.dimensions);
    for (let i = 0; i < this.dimensions; i++) {
      const byte = parseInt(hash.substring((i * 2) % hash.length, (i * 2) % hash.length + 2), 16) || 0;
      vec[i] = (byte / 255) * 2 - 1;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }
}

async function createPALTransport(): Promise<MCPTransportAdapter> {
  const adapter = new MCPTransportAdapter({
    command: '/home/vscode/.local/bin/uvx',
    args: ['--from', 'git+https://github.com/BeehiveInnovations/pal-mcp-server.git', 'pal-mcp-server'],
    env: {
      GEMINI_API_KEY: process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY ?? '',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ?? '',
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
    },
    requestTimeoutMs: 300_000,
  });
  await adapter.connect(30_000);
  return adapter;
}

function makeSemanticAuditFn(extractor: HFExtractor, scanner: VectorScanner): AuditFn {
  return async (chunk: string): Promise<boolean> => {
    try {
      const normalized = scanner.normalizeInput(chunk);
      const out = await extractor(normalized, { pooling: 'mean', normalize: true }) as { data: Float32Array };
      const vec = Array.from(out.data);
      const { distances } = await scanner.searchCoherenceDbDistances(vec, 5);
      const lambda = estimateLambda(distances);
      const starLambda = localMinCutLambda(distances);
      const ratioResult = await scanner.partitionRatioScore(vec, 5);
      const consensus = applyConsensusVoting({ ratioResult, lambda, starLambda });
      return !consensus.shouldEscalate;
    } catch (err) {
      return true;
    }
  };
}

const DB_SOURCE = 'ruvector.db';
const BACKUP_DIR = join(homedir(), 'backups', 'ruvector');
const MAX_BACKUPS = 5;

async function backupVectorDB(): Promise<void> {
  try {
    await mkdir(BACKUP_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = join(BACKUP_DIR, `ruvector_${ts}.db`);
    await copyFile(DB_SOURCE, dest);
    const entries = (await readdir(BACKUP_DIR)).filter(f => f.endsWith('.db')).sort();
    for (const old of entries.slice(0, Math.max(0, entries.length - MAX_BACKUPS))) {
      await unlink(join(BACKUP_DIR, old));
    }
  } catch (err) {}
}

export async function runGoal(
  goal: string,
  opts: { allowSecurityResearch?: boolean; outputFile?: string; contextFile?: string | null } = {},
): Promise<FlightLog> {
  const t0 = performance.now();
  const scrub = buildSecretScrubber();
  const log: FlightLog = { handoffs: [], violations: [], totalDispatches: 0, totalBlocked: 0, elapsedMs: 0 };
  const finalOutputFile = opts.outputFile || '/workspaces/turbo-flow-claude/docs/research/SPARC-Output.md';

  console.log(`[GOAP] SPARC Planner Goal received (${goal.length} chars)`);
  console.log(`\n[GOAP] === CONNECTING TRANSPORTS ===`);

  let extractor: HFExtractor | null = null;
  try {
    const { pipeline: hfPipeline, env: hfEnv } = await import('@huggingface/transformers');
    hfEnv.cacheDir = join(process.cwd(), '.claude-flow', 'data', 'models');
    hfEnv.allowRemoteModels = false;
    extractor = await hfPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { device: 'cpu' }) as unknown as HFExtractor;
  } catch (err) { }

  const cfAdapter = await createClaudeFlowTransport();
  const rvfAdapter = new MCPTransportAdapter({
    command: 'node',
    args: ['/workspaces/turbo-flow-claude/node_modules/@ruvector/rvf-mcp-server/dist/cli.js', '--transport', 'stdio'],
    env: {},
  });
  await rvfAdapter.connect();
  const palAdapter = await createPALTransport();

  const rvfBridge = new LiveRVFBridge(rvfAdapter, scrub);
  await rvfBridge.initialize('bunker.rvf');

  const scanner = new VectorScanner({ dbPath: '.claude-flow/data/attack-patterns.db', dimensions: 384 });
  await scanner.initialize();

  const semanticAuditFn: AuditFn | null = extractor ? makeSemanticAuditFn(extractor, scanner) : null;
  const liveClient = new NeuralLiveMCPClient(cfAdapter.callTool.bind(cfAdapter), scanner);
  const coordinator = new AIDefenceCoordinator({}, liveClient);
  await coordinator.initialize();
  
  const mcpBridge = new RecordingMCPBridge();
  const orchestrator = new SwarmOrchestrator(coordinator, {}, mcpBridge, rvfBridge);

  orchestrator.registerAgent('ruvbot-architect', 'architect');
  orchestrator.registerAgent('ruvbot-worker', 'worker');

  console.log(`\n[GOAP] === PHASE 1: AIDEFENCE GATE ===`);
  const goalMessage = createMessage('architect', 'worker', goal, { taskId: `SPARC-${Date.now()}`, priority: 'high', type: 'planning-goal' });

  let sanitizedGoal: string;
  try {
    log.totalDispatches++;
    const record = await orchestrator.dispatch(goalMessage);
    log.handoffs.push(record);
    sanitizedGoal = record.deliveredContent;
  } catch (err) {
    console.error(`[GOAP] BLOCKED by AIDefence:`, err);
    await orchestrator.shutdown(); await cfAdapter.disconnect(); await rvfAdapter.disconnect(); await palAdapter.disconnect();
    return log;
  }

  if (semanticAuditFn) {
    const goalResult = await decontaminate(sanitizedGoal, semanticAuditFn);
    if (!goalResult.isClean) sanitizedGoal = goalResult.cleanText;
  }

  console.log(`\n[GOAP] === PHASE 2: SPARC ARCHITECTURE CHAT ===`);
  if (opts.contextFile) console.log(`[GOAP] Injecting context file: ${opts.contextFile}`);

  let researchResponse = '';
  let responseGated = false;

  try {
    const chatResult = await palAdapter.callTool('chat', {
      prompt: sanitizedGoal,
      model: 'gemini-2.5-flash',
      working_directory_absolute_path: '/workspaces/turbo-flow-claude',
      absolute_file_paths: opts.contextFile ? [opts.contextFile] : [], // Restored!
      thinking_mode: 'high',
      temperature: 0.2,
    }) as { response?: string; content?: string; text?: string };

    const rawResponse = chatResult.response ?? chatResult.content ?? chatResult.text ?? '';
    researchResponse = scrub(rawResponse.replace(/\n[-–—]*\s*\nAGENT'S TURN:[\s\S]*/i, '').trimEnd());
    
    const responseMessage = createMessage('worker', 'architect', researchResponse, { type: 'architecture-result' });
    try {
      log.totalDispatches++;
      const respRecord = await orchestrator.dispatch(responseMessage);
      log.handoffs.push(respRecord);
    } catch (secErr) {
      if (opts.allowSecurityResearch) responseGated = true;
    }
  } catch (err) {
    researchResponse = `[ERROR: PAL chat failed — ${err}]`;
  }

  if (researchResponse && !researchResponse.startsWith('[ERROR')) {
    console.log(`\n[GOAP] === PHASE 3: WRITE OUTPUT ===`);
    const header = `# SPARC Pseudocode Document\n> Generated: ${new Date().toISOString()}\n> AIDefence: ${responseGated ? 'GATED (Override)' : 'PASSED'}\n\n---\n\n`;
    await mkdir(dirname(finalOutputFile), { recursive: true });
    await writeFile(finalOutputFile, header + researchResponse, 'utf-8');
    console.log(`[GOAP] Saved successfully to ${finalOutputFile}`);
  }

  await backupVectorDB();
  await orchestrator.shutdown();
  await cfAdapter.disconnect(); await palAdapter.disconnect(); await rvfAdapter.disconnect();
  return log;
}

const isDirectExecution = typeof process !== 'undefined' && process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isDirectExecution) {
  const { goal, allowSecurityResearch, outputFile, contextFile } = parseGoalArgs();
  if (goal) runGoal(goal, { allowSecurityResearch, outputFile, contextFile }).catch(console.error);
}