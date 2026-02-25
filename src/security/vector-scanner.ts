/**
 * RuvBot Swarm - L2 Vector Scanner (The Neural Shield)
 * PRD Reference: PRD.md v1.0.0 — Section 5.2 Layer L2, Section 7.2 (<8ms budget)
 *
 * Closes two evasion gaps proven by red-team tests:
 *   1. Unicode invisible characters (ZWS, ZWJ) bypass string matching
 *   2. Base64-encoded payloads bypass string matching
 *
 * Solution: 3-stage SONA-style normalization -> deterministic embedding -> HNSW search
 */

import { performance } from 'perf_hooks';
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { DB_CONFIG, MinCutGate, type GateDecision, estimateLambda } from './min-cut-gate.js';

export interface PartitionRatioResult {
  ratio: number;          // d_clean / d_attack — ratio > 1.0 → closer to attacks
  d_attack: number;       // avg cosine distance to k-nearest attack neighbors
  d_clean: number;        // avg cosine distance to k-nearest clean neighbors
  dbSizeAttack: number;
  dbSizeClean: number;
}

const _require = createRequire(import.meta.url);
const { VectorDB } = _require('ruvector');

// ── Types ────────────────────────────────────────────────────────────

export interface AnalysisResult {
  classification: 'attack' | 'suspicious' | 'informational';
  confidence: number;
  vector_matches: number;
  dtw_score: number;
}

export interface VectorScannerConfig {
  dbPath: string;
  /** Path to the seeded coherence DB for gate routing (ruvbot-coherence.db). */
  coherenceDbPath?: string;
  /** Path to the clean reference DB for Partition Ratio Score (ruvbot-clean-reference.db). */
  cleanReferenceDbPath?: string;
  dimensions: number;
  attackThreshold: number;
  suspiciousThreshold: number;
  searchK: number;
}

export interface ScanResultWithGate extends AnalysisResult {
  gate_decision?: GateDecision;
}

export const DEFAULT_SCANNER_CONFIG: VectorScannerConfig = {
  dbPath: '.claude-flow/data/attack-patterns.db',
  coherenceDbPath: '.claude-flow/data/ruvbot-coherence.db',
  cleanReferenceDbPath: '.claude-flow/data/ruvbot-clean-reference.db',
  dimensions: 384,
  attackThreshold: 0.3,
  suspiciousThreshold: 0.5,
  searchK: 5,
};

// ── Homoglyph Map (Cyrillic -> Latin) ────────────────────────────────

const HOMOGLYPH_MAP: Record<string, string> = {
  '\u0430': 'a', '\u0410': 'A',  // а -> a
  '\u0441': 'c', '\u0421': 'C',  // с -> c
  '\u0435': 'e', '\u0415': 'E',  // е -> e
  '\u043E': 'o', '\u041E': 'O',  // о -> o
  '\u0440': 'p', '\u0420': 'P',  // р -> p
  '\u0445': 'x', '\u0425': 'X',  // х -> x
  '\u0443': 'y', '\u0423': 'Y',  // у -> y
  '\u0456': 'i', '\u0406': 'I',  // і -> i
  '\u0458': 'j', '\u0408': 'J',  // ј -> j
  '\u0455': 's', '\u0405': 'S',  // ѕ -> s
};

// ── Normalization Pipeline ───────────────────────────────────────────

/**
 * Stage 1: Strip invisible Unicode, diacritics, and homoglyphs.
 */
function stripUnicode(text: string): string {
  // Remove zero-width characters
  let out = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u180E]/g, '');

  // Decompose and strip combining diacritical marks (U+0300..U+036F)
  out = out.normalize('NFD').replace(/[\u0300-\u036F]/g, '');

  // Compatibility composition
  out = out.normalize('NFKC');

  // Replace homoglyphs
  let result = '';
  for (const ch of out) {
    result += HOMOGLYPH_MAP[ch] ?? ch;
  }

  return result;
}

/**
 * Stage 2: Detect and decode encoded payloads (Base64, hex, URL-encoded).
 * Decoded text is appended so the vectorizer sees hidden content.
 */
function decodePayloads(text: string): string {
  const decoded: string[] = [];

  // Base64: match runs of 20+ base64 chars (avoids false positives on short words)
  const b64Matches = text.match(/[A-Za-z0-9+/]{20,}={0,2}/g);
  if (b64Matches) {
    for (const m of b64Matches) {
      try {
        const plain = Buffer.from(m, 'base64').toString('utf-8');
        // Only accept if it looks like readable ASCII text
        if (/^[\x20-\x7E]+$/.test(plain) && plain.length >= 4) {
          decoded.push(plain);
        }
      } catch { /* skip invalid */ }
    }
  }

  // Hex escape sequences: \x41 -> 'A'
  let out = text.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  // URL encoding: %20 -> ' '
  out = out.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );

  // HTML numeric entities: &#65; -> 'A'
  out = out.replace(/&#(\d+);/g, (_, dec) =>
    String.fromCharCode(parseInt(dec, 10)),
  );

  if (decoded.length > 0) {
    out = out + ' ' + decoded.join(' ');
  }

  return out;
}

/**
 * Stage 3: Canonicalize text (lowercase, collapse whitespace).
 */
function canonicalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Full 3-stage normalization pipeline.
 */
export function normalizeInput(input: string): string {
  const s1 = stripUnicode(input);
  const s2 = decodePayloads(s1);
  return canonicalize(s2);
}

/**
 * Deterministic text-to-vector embedding.
 * Must match the function used to seed the HNSW index.
 * Performance: <1ms for typical inputs.
 */
export function textToVector(text: string, dimensions = 384): number[] {
  const v = new Float32Array(dimensions);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const idx = (code * 31 + i * 17) % dimensions;
    v[idx] += 1.0;
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  const out: number[] = new Array(dimensions);
  for (let i = 0; i < dimensions; i++) out[i] = v[i] / norm;
  return out;
}

// ── VectorScanner Class ──────────────────────────────────────────────

interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export interface PatternEntry {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface ThreatCluster {
  category: string;
  count: number;
  density: number;
  centroid: number[];
  patternIds: string[];
}

export class VectorScanner {
  private config: VectorScannerConfig;
  private db: InstanceType<typeof VectorDB> | null = null;
  private coherenceDb: InstanceType<typeof VectorDB> | null = null;
  private cleanDb: InstanceType<typeof VectorDB> | null = null;
  private initialized = false;
  private patternRegistry: PatternEntry[] = [];
  private minCutGate = new MinCutGate();
  private coherenceGate = new MinCutGate();
  private lastGateDecision: GateDecision | null = null;

  constructor(config: Partial<VectorScannerConfig> = {}) {
    this.config = { ...DEFAULT_SCANNER_CONFIG, ...config };
  }

  /** Open the vector database. Must be called before scan(). */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure the data directory exists before VectorDB tries to create the file.
    // Previously this was omitted, causing silent in-memory fallback.
    mkdirSync(dirname(this.config.dbPath), { recursive: true });

    // Phase 15 fix: use correct @ruvector/core field names.
    // Old (broken): { path, metric: 'cosine' } — fields silently ignored → in-memory only.
    // New (correct): { storagePath, distanceMetric: 'Cosine' } — persists to disk.
    this.db = new VectorDB({
      storagePath: this.config.dbPath,
      dimensions: this.config.dimensions,
      distanceMetric: 'Cosine',       // capital C required — lowercase throws enum error
      hnswConfig: {
        m: DB_CONFIG.m,
        efConstruction: DB_CONFIG.efConstruction,
        efSearch: DB_CONFIG.efSearch,
        maxElements: DB_CONFIG.maxElements,
      },
    });

    // Open coherence DB for gate routing (separate from attack-patterns DB).
    // Fails gracefully — gate defaults to L3_Gate if DB is unavailable.
    if (this.config.coherenceDbPath) {
      try {
        mkdirSync(dirname(this.config.coherenceDbPath), { recursive: true });
        this.coherenceDb = new VectorDB({
          storagePath: this.config.coherenceDbPath,
          dimensions: this.config.dimensions,
          distanceMetric: 'Cosine',
          hnswConfig: {
            m: DB_CONFIG.m,
            efConstruction: DB_CONFIG.efConstruction,
            efSearch: DB_CONFIG.efSearch,
            maxElements: DB_CONFIG.maxElements,
          },
        });
      } catch (err) {
        console.warn('[VectorScanner] Coherence DB unavailable (gate will default to L3):', err);
      }
    }

    // Open clean reference DB for Partition Ratio Score.
    // Fails gracefully — partitionRatioScore() returns null if unavailable.
    if (this.config.cleanReferenceDbPath) {
      try {
        mkdirSync(dirname(this.config.cleanReferenceDbPath), { recursive: true });
        this.cleanDb = new VectorDB({
          storagePath: this.config.cleanReferenceDbPath,
          dimensions: this.config.dimensions,
          distanceMetric: 'Cosine',
          hnswConfig: {
            m: DB_CONFIG.m,
            efConstruction: DB_CONFIG.efConstruction,
            efSearch: DB_CONFIG.efSearch,
            maxElements: DB_CONFIG.maxElements,
          },
        });
      } catch (err) {
        console.warn('[VectorScanner] Clean reference DB unavailable (partitionRatioScore will return null):', err);
      }
    }

    this.initialized = true;
  }

  /** Expose normalization for external use / testing. */
  normalizeInput(input: string): string {
    return normalizeInput(input);
  }

  /** Expose embedding for external use / testing. */
  textToVector(text: string): number[] {
    return textToVector(text, this.config.dimensions);
  }

  /**
   * Full L2 scan pipeline: normalize -> embed -> HNSW search -> classify.
   * Target: <8ms total (PRD Section 7.2).
   */
  async scan(input: string): Promise<AnalysisResult> {
    if (!this.initialized) await this.initialize();

    const t0 = performance.now();

    // 1. Normalize (defeats Unicode + Base64 + homoglyph evasion)
    const normalized = normalizeInput(input);

    // Edge case: input was all invisible chars
    if (!normalized && input.length > 0) {
      return {
        classification: 'suspicious',
        confidence: 0.8,
        vector_matches: 0,
        dtw_score: 1.0,
      };
    }

    // 2. Embed (<1ms)
    const vector = textToVector(normalized, this.config.dimensions);

    // 3. HNSW search
    let results: SearchResult[] = [];
    try {
      results = await this.db!.search({ vector, k: this.config.searchK });
    } catch (err) {
      // Fail-open: return informational, let L1/L3 handle threats
      console.error('[VectorScanner] HNSW search failed:', err);
      return { classification: 'informational', confidence: 0, vector_matches: 0, dtw_score: 1.0 };
    }

    // 3a. λ-gate routing decision (Phase 15 AISP spec ⟦Γ⟧)
    // knnDistances: cosine distance (lower = closer match)
    const knnDistances = results.map(r => r.score);
    this.lastGateDecision = this.minCutGate.decide(knnDistances, this.patternRegistry.length);

    // 4. Classify based on cosine distance thresholds
    let bestScore = 1.0;
    let matchCount = 0;
    let isAttack = false;
    let isSuspicious = false;
    let maxSeverity = 0;

    for (const hit of results) {
      if (hit.score < bestScore) bestScore = hit.score;

      if (hit.score < this.config.suspiciousThreshold) {
        matchCount++;
        const severity = (hit.metadata?.severity as number) ?? 0.5;

        if (hit.score < this.config.attackThreshold) {
          isAttack = true;
          maxSeverity = Math.max(maxSeverity, severity);
        } else {
          isSuspicious = true;
        }
      }
    }

    // 5. Compute classification and confidence
    let classification: AnalysisResult['classification'] = 'informational';
    let confidence = 0;

    if (isAttack) {
      classification = 'attack';
      confidence = (1.0 - bestScore) * (0.5 + maxSeverity * 0.5);
    } else if (isSuspicious) {
      classification = 'suspicious';
      confidence = (1.0 - bestScore) * 0.6;
    }

    confidence = Math.min(Math.max(confidence, 0), 1);

    const elapsed = performance.now() - t0;
    if (elapsed > 8.0) {
      console.warn(`[VectorScanner] L2 budget exceeded: ${elapsed.toFixed(2)}ms > 8ms`);
    }

    return {
      classification,
      confidence: parseFloat(confidence.toFixed(2)),
      vector_matches: matchCount,
      dtw_score: parseFloat(bestScore.toFixed(4)),
    };
  }

  // ── Adaptive Learning ───────────────────────────────────────────────

  /**
   * Insert a new threat pattern into the HNSW index.
   * Used by AdaptiveLearner to harden the shield with confirmed threats.
   */
  async insertPattern(pattern: PatternEntry): Promise<void> {
    if (!this.initialized) await this.initialize();
    await this.db!.insert({
      id: pattern.id,
      vector: pattern.vector,
      metadata: pattern.metadata,
    });
    this.patternRegistry.push(pattern);
  }

  /**
   * Return cluster analysis of the HNSW index (top 5 densest regions).
   * Groups patterns by metadata.category, computes centroid + density.
   */
  getThreatMap(): ThreatCluster[] {
    const groups = new Map<string, PatternEntry[]>();
    for (const p of this.patternRegistry) {
      const cat = (p.metadata.category as string) ?? 'unknown';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }

    const dims = this.config.dimensions;
    const clusters: ThreatCluster[] = [];

    for (const [category, patterns] of groups) {
      // Centroid = mean vector
      const centroid = new Array<number>(dims).fill(0);
      for (const p of patterns) {
        for (let i = 0; i < dims; i++) centroid[i] += p.vector[i];
      }
      for (let i = 0; i < dims; i++) centroid[i] /= patterns.length;

      // Average pairwise cosine distance (lower = tighter cluster)
      let totalDist = 0;
      let pairs = 0;
      for (let i = 0; i < patterns.length; i++) {
        for (let j = i + 1; j < patterns.length; j++) {
          let dot = 0;
          for (let d = 0; d < dims; d++) dot += patterns[i].vector[d] * patterns[j].vector[d];
          totalDist += 1 - dot;
          pairs++;
        }
      }

      const avgDist = pairs > 0 ? totalDist / pairs : 0;
      // density = count / avgDist. Zero distance = maximally tight cluster.
      const density = avgDist > 1e-10 ? patterns.length / avgDist : patterns.length * 1e6;

      clusters.push({
        category,
        count: patterns.length,
        density: parseFloat(density.toFixed(2)),
        centroid,
        patternIds: patterns.map(p => p.id),
      });
    }

    clusters.sort((a, b) => b.density - a.density);
    return clusters.slice(0, 5);
  }

  /** Number of patterns tracked by this instance. */
  get registrySize(): number {
    return this.patternRegistry.length;
  }

  /**
   * Last gate routing decision from scan().
   * Includes λ estimate, threshold, and whether MinCut_Gate was selected.
   * null if scan() has not been called yet.
   */
  get lastGate(): GateDecision | null {
    return this.lastGateDecision;
  }

  /**
   * Measure λ for a given set of k-NN distances (exposed for testing).
   */
  measureLambda(knnDistances: number[]): number {
    return estimateLambda(knnDistances);
  }

  /**
   * Search the coherence DB and return the raw cosine distances (not yet
   * aggregated into λ). Used by calibration probes that need per-neighbor
   * distances for Stoer-Wagner star-graph min-cut computation.
   *
   * Fails safe: returns empty array if DB unavailable or search throws.
   */
  async searchCoherenceDbDistances(vector: number[], k: number): Promise<{ distances: number[]; dbSize: number }> {
    if (!this.initialized) await this.initialize();
    if (!this.coherenceDb) return { distances: [], dbSize: 0 };

    try {
      const results = await this.coherenceDb.search({ vector, k });
      const distances: number[] = results.map((r: SearchResult) => r.score);
      const dbSize = await this.coherenceDb.len();
      return { distances, dbSize };
    } catch (err) {
      console.warn('[VectorScanner] searchCoherenceDbDistances failed (fail-open):', err);
      return { distances: [], dbSize: 0 };
    }
  }

  /**
   * Search the coherence DB with a pre-computed semantic embedding and return
   * the raw λ density proxy + DB size. Used by the async auditor in runGoal()
   * which supplies a true ONNX embedding instead of the fast-path char-code proxy.
   *
   * Fails safe: returns λ=0 if the coherence DB is unavailable or search throws.
   */
  async searchCoherenceDb(vector: number[], k: number): Promise<{ lambda: number; dbSize: number }> {
    if (!this.initialized) await this.initialize();
    if (!this.coherenceDb) return { lambda: 0, dbSize: 0 };

    try {
      const results = await this.coherenceDb.search({ vector, k });
      const dists = results.map((r: SearchResult) => r.score);
      const dbSize = await this.coherenceDb.len();
      const lambda = estimateLambda(dists);
      return { lambda, dbSize };
    } catch (err) {
      console.warn('[VectorScanner] searchCoherenceDb failed (fail-open):', err);
      return { lambda: 0, dbSize: 0 };
    }
  }

  /**
   * Compute the Partition Ratio Score for a pre-computed ONNX embedding.
   *
   * ratio = d_clean / d_attack
   *
   * Where d_attack = avg cosine distance to k nearest neighbors in the
   * attack coherence DB (ruvbot-coherence.db) and d_clean = avg cosine
   * distance to k nearest neighbors in the clean reference DB
   * (ruvbot-clean-reference.db, seeded with 50 benign prompts).
   *
   * ratio > PARTITION_RATIO_THRESHOLD (1.0) → closer to attack space
   * ratio ≤ PARTITION_RATIO_THRESHOLD (1.0) → closer to clean space
   *
   * Returns null if either DB is unavailable (caller should fall back to λ).
   * Never throws to the caller.
   */
  async partitionRatioScore(vector: number[], k: number): Promise<PartitionRatioResult | null> {
    if (!this.initialized) await this.initialize();
    if (!this.coherenceDb || !this.cleanDb) return null;

    try {
      const [attackResults, cleanResults, attackSize, cleanSize] = await Promise.all([
        this.coherenceDb.search({ vector, k }),
        this.cleanDb.search({ vector, k }),
        this.coherenceDb.len(),
        this.cleanDb.len(),
      ]);

      const attackDists: number[] = attackResults.map((r: SearchResult) => r.score);
      const cleanDists: number[]  = cleanResults.map((r: SearchResult) => r.score);

      if (attackDists.length === 0 || cleanDists.length === 0) return null;

      const d_attack = attackDists.reduce((a, b) => a + b, 0) / attackDists.length;
      const d_clean  = cleanDists.reduce((a, b) => a + b, 0) / cleanDists.length;

      // Avoid division by zero: if attack DB is empty / returns zero distances
      if (d_attack < 1e-9) return null;

      return {
        ratio: d_clean / d_attack,
        d_attack,
        d_clean,
        dbSizeAttack: attackSize,
        dbSizeClean: cleanSize,
      };
    } catch (err) {
      console.warn('[VectorScanner] partitionRatioScore failed (fail-open):', err);
      return null;
    }
  }

  /**
   * Compute the MinCutGate routing decision for an input by searching
   * the coherence DB (ruvbot-coherence.db, seeded with 630 synthetic patterns).
   *
   * Uses db.len() — not patternRegistry.length — so the gate reflects
   * the persisted DB size regardless of how many patterns were inserted
   * in this session.
   *
   * Fails safe: returns L3_Gate decision if the coherence DB is unavailable
   * or the search throws. Never throws to the caller.
   */
  async computeGateDecision(input: string): Promise<GateDecision> {
    if (!this.initialized) await this.initialize();

    if (!this.coherenceDb) {
      return this.coherenceGate.decide([], 0);  // safe default
    }

    const normalized = normalizeInput(input);
    const vector = textToVector(normalized, this.config.dimensions);

    try {
      const results = await this.coherenceDb.search({ vector, k: this.config.searchK });
      const knnDistances = results.map((r: SearchResult) => r.score);
      const dbSize = await this.coherenceDb.len();
      return this.coherenceGate.decide(knnDistances, dbSize);
    } catch (err) {
      console.warn('[VectorScanner] Coherence gate search failed (L3_Gate default):', err);
      return this.coherenceGate.decide([], 0);
    }
  }
}
