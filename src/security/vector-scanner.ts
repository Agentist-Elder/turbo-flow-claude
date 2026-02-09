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
  dimensions: number;
  attackThreshold: number;
  suspiciousThreshold: number;
  searchK: number;
}

export const DEFAULT_SCANNER_CONFIG: VectorScannerConfig = {
  dbPath: '.claude-flow/data/attack-patterns.db',
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

export class VectorScanner {
  private config: VectorScannerConfig;
  private db: InstanceType<typeof VectorDB> | null = null;
  private initialized = false;

  constructor(config: Partial<VectorScannerConfig> = {}) {
    this.config = { ...DEFAULT_SCANNER_CONFIG, ...config };
  }

  /** Open the vector database. Must be called before scan(). */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.db = new VectorDB({
      path: this.config.dbPath,
      dimensions: this.config.dimensions,
      metric: 'cosine',
    });
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
}
