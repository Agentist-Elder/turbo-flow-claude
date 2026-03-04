/**
 * Phase P2 — Ephemeral Cache (Layer 1.5 / The Circuit Breaker)
 *
 * Fast, in-memory SHA-256 cache that intercepts payloads BEFORE they reach
 * the expensive LLM Surgeon.  Solves two problems simultaneously:
 *
 *   1. Sybil / Variant Flood: An attacker firing 100 surface mutations of the
 *      same Zero-Day would burn Surgeon tokens for each variant.  The cache
 *      hashes raw text and drops exact duplicates in O(1) time.
 *
 *   2. Polymorphic Clustering: Each novel attack is fingerprinted on first
 *      sight.  The quarantine DB groups all subsequent variants under the same
 *      fingerprint so the Triage Dashboard shows one cluster per Zero-Day,
 *      not 100 identical entries.
 *
 * This class is pure in-memory state — no I/O, no dependencies.
 * It is flushed by the Triage Dashboard when a human operator approves or
 * discards a quarantine batch, resetting the circuit breaker for the next
 * wave.
 *
 * Notes:
 *   - SHA-256 is used because (a) it is already imported for the L3 Gateway
 *     content digest, and (b) cryptographic collision resistance is sufficient
 *     for the dedup use case.
 *   - fingerprint() truncates to 32 hex chars (128 bits) for display/storage;
 *     the full 256-bit hash is held only inside Map keys.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Per-fingerprint record held in the cache. */
export interface CacheEntry {
  /** Wall-clock timestamp (Date.now()) of the first sighting. */
  firstSeen: number;
  /** How many times this exact hash has been seen (including the first). */
  count: number;
  /** First 80 chars of the original text — diagnostic display only. */
  preview: string;
}

// ---------------------------------------------------------------------------
// EphemeralCache
// ---------------------------------------------------------------------------

/**
 * Layer 1.5 deduplication cache.
 *
 * Typical usage in the request path:
 *
 *   const result = cache.check(text);
 *   if (result === 'seen') return { result: 'cached_blocked' };
 *   cache.record(text);
 *   // → proceed to Surgeon
 */
export class EphemeralCache {
  private readonly store = new Map<string, CacheEntry>();
  private _totalChecks = 0;
  private _totalHits   = 0;

  // ── Statistics ────────────────────────────────────────────────────────────

  /** Number of distinct fingerprints currently held. */
  get size(): number { return this.store.size; }

  /** Total number of check() calls since construction or last flush(). */
  get totalChecks(): number { return this._totalChecks; }

  /** Total number of cache hits (check() returned 'seen'). */
  get totalHits(): number { return this._totalHits; }

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Compute a 32-char hex fingerprint (first 128 bits of SHA-256) for `text`.
   *
   * Deterministic and suitable for logging, storage, and display.
   * Not a method on instances so callers can fingerprint without a cache instance.
   */
  static fingerprint(text: string): string {
    return createHash('sha256').update(text, 'utf-8').digest('hex').slice(0, 32);
  }

  /**
   * Check whether `text` has been recorded in the cache.
   *
   * - Increments totalChecks on every call.
   * - Increments the stored count and totalHits when 'seen'.
   * - Does NOT record new text — call record() separately after 'new'.
   */
  check(text: string): 'seen' | 'new' {
    this._totalChecks++;
    const key = EphemeralCache.fingerprint(text);
    const existing = this.store.get(key);
    if (existing !== undefined) {
      existing.count++;
      this._totalHits++;
      return 'seen';
    }
    return 'new';
  }

  /**
   * Record `text` in the cache.
   *
   * Call this after check() returns 'new'.  Idempotent: if the fingerprint
   * already exists (e.g. due to a race on the JS event loop), the existing
   * entry is left unchanged.
   */
  record(text: string): void {
    const key = EphemeralCache.fingerprint(text);
    if (!this.store.has(key)) {
      this.store.set(key, {
        firstSeen: Date.now(),
        count:     1,
        preview:   text.slice(0, 80),
      });
    }
  }

  /**
   * Remove all entries and reset hit counters.
   *
   * Called by the Triage Dashboard when a human operator approves or discards
   * a quarantine batch.  Resetting the cache prevents stale SHA-256 hashes
   * from blocking a legitimately rewritten clean message in the next session.
   */
  flush(): void {
    this.store.clear();
    this._totalChecks = 0;
    this._totalHits   = 0;
  }

  /**
   * Return a snapshot of all cached entries for diagnostic purposes.
   * The returned array is a copy; mutations do not affect the cache.
   */
  entries(): Array<{ fingerprint: string; entry: CacheEntry }> {
    return Array.from(this.store.entries()).map(([fingerprint, entry]) => ({
      fingerprint,
      entry: { ...entry },
    }));
  }
}
