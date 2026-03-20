/**
 * Learning gate unit tests — shouldLearnFromSurgeon()
 *
 * Guards against:
 *   - benign-classified content being stored as a failure pattern (false-positive amplifier)
 *   - manipulated Surgeon responses writing arbitrary attackType strings into the learning store
 *   - low-confidence verdicts polluting ReflexionMemory
 */

import { describe, it, expect } from 'vitest';
import { shouldLearnFromSurgeon, VALID_ATTACK_TYPES } from '../../scripts/poc/poc-server.js';

// ---------------------------------------------------------------------------
// shouldLearnFromSurgeon
// ---------------------------------------------------------------------------

describe('shouldLearnFromSurgeon', () => {
  it('returns true for high-confidence known attack type', () => {
    expect(shouldLearnFromSurgeon({ confidence: 0.92, attackType: 'identity-override' })).toBe(true);
    expect(shouldLearnFromSurgeon({ confidence: 0.70, attackType: 'instruction-injection' })).toBe(true);
    expect(shouldLearnFromSurgeon({ confidence: 0.85, attackType: 'data-exfiltration' })).toBe(true);
  });

  it('returns false when attackType is benign — even at high confidence', () => {
    expect(shouldLearnFromSurgeon({ confidence: 0.95, attackType: 'benign' })).toBe(false);
    expect(shouldLearnFromSurgeon({ confidence: 0.70, attackType: 'benign' })).toBe(false);
  });

  it('returns false when confidence is below 0.70', () => {
    expect(shouldLearnFromSurgeon({ confidence: 0.69, attackType: 'identity-override' })).toBe(false);
    expect(shouldLearnFromSurgeon({ confidence: 0.0,  attackType: 'privilege-escalation' })).toBe(false);
  });

  it('returns false when attackType is not in the allowlist', () => {
    expect(shouldLearnFromSurgeon({ confidence: 0.90, attackType: 'definitely-not-valid' })).toBe(false);
    expect(shouldLearnFromSurgeon({ confidence: 0.90, attackType: '' })).toBe(false);
    expect(shouldLearnFromSurgeon({ confidence: 0.90, attackType: 'IDENTITY-OVERRIDE' })).toBe(false); // case-sensitive
  });

  it('returns false when confidence is exactly at boundary (0.70 passes, 0.699 does not)', () => {
    expect(shouldLearnFromSurgeon({ confidence: 0.70,  attackType: 'encoding-evasion' })).toBe(true);
    expect(shouldLearnFromSurgeon({ confidence: 0.699, attackType: 'encoding-evasion' })).toBe(false);
  });

  it('unknown attackType with high confidence is allowed (Surgeon uncertain but flagging)', () => {
    expect(shouldLearnFromSurgeon({ confidence: 0.75, attackType: 'unknown' })).toBe(true);
  });

  it('all valid attack types are accepted at 0.70 confidence', () => {
    for (const type of VALID_ATTACK_TYPES) {
      if (type === 'benign') continue; // benign is explicitly blocked
      expect(
        shouldLearnFromSurgeon({ confidence: 0.70, attackType: type }),
        `expected true for attackType '${type}'`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// VALID_ATTACK_TYPES allowlist completeness
// ---------------------------------------------------------------------------

describe('VALID_ATTACK_TYPES', () => {
  it('contains all expected attack categories', () => {
    const expected = [
      'identity-override', 'instruction-injection', 'jailbreak-persona',
      'encoding-evasion', 'social-engineering', 'data-exfiltration',
      'privilege-escalation', 'benign', 'unknown',
    ];
    for (const t of expected) {
      expect(VALID_ATTACK_TYPES.has(t), `expected '${t}' in VALID_ATTACK_TYPES`).toBe(true);
    }
  });

  it('has exactly 9 entries — adding new types requires a deliberate code change', () => {
    expect(VALID_ATTACK_TYPES.size).toBe(9);
  });
});
