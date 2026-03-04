/**
 * Phase P3 — LLM Surgeon (Layer 2 Semantic Analyst)
 *
 * Replaces the heuristic stub in poc-server.ts with a real Gemini call.
 *
 * Design:
 *   ISurgeon          — thin interface so tests can inject StubSurgeon
 *   GeminiSurgeon     — uses gemini-2.5-flash with a structured JSON prompt
 *   StubSurgeon       — deterministic heuristic fallback (mirrors poc-server stub)
 *   createSurgeon()   — factory: returns GeminiSurgeon if GOOGLE_API_KEY is set,
 *                       StubSurgeon otherwise
 *
 * SurgeonResult is intentionally identical to what poc-server already uses,
 * plus a `raw` field for the full Gemini response text (audit trail).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SurgeonResult {
  attackType:     string;
  coreIntent:     string;
  confidence:     number;
  recommendation: string;
  /** Full raw text returned by the LLM — empty string for StubSurgeon. */
  raw:            string;
  /** Which surgeon produced this result. */
  source:         'gemini' | 'stub';
}

export interface ISurgeon {
  analyze(text: string): Promise<SurgeonResult>;
}

// ---------------------------------------------------------------------------
// Gemini Surgeon
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a prompt-injection security analyst.
Analyse the input text and return ONLY a single JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "attackType":     "<string: one of identity-override | instruction-injection | jailbreak-persona | encoding-evasion | social-engineering | data-exfiltration | privilege-escalation | unknown>",
  "coreIntent":     "<string: one sentence describing what the attacker is trying to achieve>",
  "confidence":     <number: 0.0–1.0, your confidence that this is a real attack>,
  "recommendation": "<string: one sentence action for the security team>"
}

If the text is benign, set attackType to "benign", confidence to 0.05, and explain briefly.`;

/**
 * Calls Gemini via the REST API (no SDK dependency — mirrors the project's
 * zero-external-dep philosophy for security-critical code).
 */
export class GeminiSurgeon implements ISurgeon {
  private readonly apiKey: string;
  private readonly model:  string;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async analyze(text: string): Promise<SurgeonResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const requestBody = {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role:  'user',
        parts: [{ text }],
      }],
      generationConfig: {
        temperature:      0.1,   // near-deterministic for classification
        maxOutputTokens:  512,
        responseMimeType: 'application/json',
      },
    };

    const resp = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new GeminiSurgeonError(
        `Gemini API error ${resp.status}: ${errText.slice(0, 200)}`,
        resp.status,
      );
    }

    const data = await resp.json() as GeminiResponse;
    const raw  = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!raw) {
      throw new GeminiSurgeonError('Gemini returned an empty response', 200);
    }

    let parsed: Partial<SurgeonResult>;
    try {
      parsed = JSON.parse(raw) as Partial<SurgeonResult>;
    } catch {
      throw new GeminiSurgeonError(`Gemini response is not valid JSON: ${raw.slice(0, 200)}`, 200);
    }

    return {
      attackType:     String(parsed.attackType     ?? 'unknown'),
      coreIntent:     String(parsed.coreIntent     ?? ''),
      confidence:     Number(parsed.confidence     ?? 0.5),
      recommendation: String(parsed.recommendation ?? ''),
      raw,
      source:         'gemini',
    };
  }
}

export class GeminiSurgeonError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'GeminiSurgeonError';
  }
}

// Minimal shape we need from the Gemini REST response
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

// ---------------------------------------------------------------------------
// Stub Surgeon  (deterministic heuristic fallback — same logic as the old stub)
// ---------------------------------------------------------------------------

export class StubSurgeon implements ISurgeon {
  async analyze(text: string): Promise<SurgeonResult> {
    const lower = text.toLowerCase();

    if (
      lower.includes('maintenance mode') ||
      lower.includes('admin_override')   ||
      lower.includes('directives have been replaced')
    ) {
      return {
        attackType:     'identity-override',
        coreIntent:     "Attempts to replace the model's identity or suspend safety " +
                        'constraints via privileged admin / maintenance-mode framing.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. High-confidence identity-override ' +
                        'jailbreak. Verify with LLM Surgeon before finalising.',
        raw:    '',
        source: 'stub',
      };
    }

    if (lower.includes('ignore previous') || lower.includes('forget your instructions')) {
      return {
        attackType:     'instruction-injection',
        coreIntent:     'Attempts to erase prior context and inject replacement directives.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. Classic prompt injection pattern.',
        raw:    '',
        source: 'stub',
      };
    }

    if (
      lower.includes('developer mode') ||
      lower.includes('jailbreak')      ||
      /\bdan\b/.test(lower)
    ) {
      return {
        attackType:     'jailbreak-persona',
        coreIntent:     'Invokes a known jailbreak persona (DAN / developer mode) to ' +
                        'bypass content guidelines.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. Named jailbreak pattern.',
        raw:    '',
        source: 'stub',
      };
    }

    if (lower.includes('base64') || lower.includes('decode this')) {
      return {
        attackType:     'encoding-evasion',
        coreIntent:     'Uses encoding obfuscation to evade text-based content filters.',
        confidence:     0.5,
        recommendation: 'Promote to ruvector-sec.db. Encoding evasion pattern.',
        raw:    '',
        source: 'stub',
      };
    }

    return {
      attackType:     'unknown',
      coreIntent:     'Pattern not matched by stub heuristics. Pending LLM Surgeon review.',
      confidence:     0.1,
      recommendation: 'Manual review required.',
      raw:    '',
      source: 'stub',
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a GeminiSurgeon if an API key is available, StubSurgeon otherwise.
 * The PoC server calls this once at startup; tests inject StubSurgeon directly.
 */
export function createSurgeon(apiKey?: string): ISurgeon {
  const key = apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
  if (key.length > 0) {
    return new GeminiSurgeon(key);
  }
  console.warn('[Surgeon] No GOOGLE_API_KEY found — falling back to StubSurgeon');
  return new StubSurgeon();
}
