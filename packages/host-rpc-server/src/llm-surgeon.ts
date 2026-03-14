/**
 * Phase P3 — LLM Surgeon (Layer 3 Semantic Analyst)
 *
 * Design:
 *   ISurgeon          — thin interface so tests can inject StubSurgeon
 *   TribunalSurgeon   — 3-agent tribunal: Hunter + Explainer run in parallel,
 *                       Arbiter weighs both and makes the operational call.
 *                       Default when GOOGLE_API_KEY is set.
 *   GeminiSurgeon     — single-agent fallback (original P3 implementation).
 *                       Kept for backward compatibility and test injection.
 *   StubSurgeon       — deterministic heuristic fallback (no API key required)
 *   createSurgeon()   — factory: returns TribunalSurgeon if GOOGLE_API_KEY is
 *                       set, StubSurgeon otherwise.
 *
 * SurgeonResult.source is 'tribunal' | 'gemini' | 'stub'.
 * The `raw` field for TribunalSurgeon is a JSON string containing the full
 * Hunter, Explainer, and Arbiter outputs for audit trail.
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
  source:         'tribunal' | 'gemini' | 'stub';
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
// Shared internal Gemini helper (used by both GeminiSurgeon & TribunalSurgeon)
// ---------------------------------------------------------------------------

async function callGeminiRaw(
  apiKey:       string,
  model:        string,
  systemPrompt: string,
  userText:     string,
): Promise<unknown> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: {
        temperature:      0.1,
        maxOutputTokens:  512,
        responseMimeType: 'application/json',
      },
    }),
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

  try {
    return JSON.parse(raw);
  } catch {
    throw new GeminiSurgeonError(
      `Gemini response is not valid JSON: ${raw.slice(0, 200)}`,
      200,
    );
  }
}

// ---------------------------------------------------------------------------
// Tribunal Surgeon — 3-agent adversarial debate (default when API key present)
// ---------------------------------------------------------------------------

const HUNTER_PROMPT = `You are a security threat hunter analysing a potential prompt injection or AI manipulation attempt.
Assume adversarial intent until evidence disproves it. Find the strongest case that this interaction is malicious.

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "suspectedTarget":       "<hidden_instructions|credentials|safeguard_bypass|data_exfiltration|identity_override|unknown>",
  "method":                "<direct_command|roleplay|encoding|hypothetical|gradual_escalation|academic_framing|unknown>",
  "evidenceQuotes":        ["<verbatim quote from input>", ...],
  "consequenceIfAllowed":  "<one sentence: what happens if the agent complies>",
  "riskLevel":             "<high|medium|low>",
  "confidence":            <number 0.0–1.0>
}`;

const EXPLAINER_PROMPT = `You are a defence counsel reviewing a flagged AI interaction.
Assume good faith until evidence disproves it. Find the strongest innocent explanation for this interaction.

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "plausiblePurpose":        "<one sentence: most charitable legitimate interpretation>",
  "counterEvidence":         "<what in the input argues against malicious intent>",
  "weaknessInThreatTheory":  "<what the adversarial reading overstates or gets wrong>",
  "falsePositiveRisk":       "<high|medium|low>",
  "confidence":              <number 0.0–1.0, confidence the interaction is benign>
}`;

const ARBITER_PROMPT = `You are a security adjudicator weighing two expert analyses of a flagged AI interaction.
Make the operationally correct decision. Focus on the consequence of compliance, not just surface wording.

You will receive the original interaction text, then Threat Hunter findings (JSON), then Benign Explainer findings (JSON).

Return ONLY a JSON object — no markdown, no explanation.

JSON schema (all fields required):
{
  "attackType":     "<identity-override|instruction-injection|jailbreak-persona|encoding-evasion|social-engineering|data-exfiltration|privilege-escalation|benign|unknown>",
  "coreIntent":     "<one sentence: what the interaction is ultimately trying to achieve>",
  "confidence":     <number 0.0–1.0, confidence in this verdict>,
  "recommendation": "<one sentence operational action: allow / block / quarantine / escalate-to-human + brief reason>"
}`;

export class TribunalSurgeon implements ISurgeon {
  private readonly apiKey: string;
  private readonly model:  string;

  constructor(apiKey: string, model = 'gemini-2.5-flash') {
    this.apiKey = apiKey;
    this.model  = model;
  }

  async analyze(text: string): Promise<SurgeonResult> {
    // Step 1: Hunter and Explainer run in parallel
    const [hunterRaw, explainerRaw] = await Promise.all([
      callGeminiRaw(this.apiKey, this.model, HUNTER_PROMPT, text),
      callGeminiRaw(this.apiKey, this.model, EXPLAINER_PROMPT, text),
    ]);

    // Step 2: Arbiter receives original text + both structured findings
    const arbiterUserText = [
      'ORIGINAL INTERACTION:',
      text,
      '',
      'THREAT HUNTER FINDINGS:',
      JSON.stringify(hunterRaw, null, 2),
      '',
      'BENIGN EXPLAINER FINDINGS:',
      JSON.stringify(explainerRaw, null, 2),
    ].join('\n');

    const arbiterRaw = await callGeminiRaw(
      this.apiKey, this.model, ARBITER_PROMPT, arbiterUserText,
    ) as Partial<SurgeonResult>;

    const auditLog = { hunter: hunterRaw, explainer: explainerRaw, arbiter: arbiterRaw };

    return {
      attackType:     String(arbiterRaw.attackType     ?? 'unknown'),
      coreIntent:     String(arbiterRaw.coreIntent     ?? ''),
      confidence:     Number(arbiterRaw.confidence     ?? 0.5),
      recommendation: String(arbiterRaw.recommendation ?? ''),
      raw:            JSON.stringify(auditLog),
      source:         'tribunal',
    };
  }
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
 * Returns a TribunalSurgeon (3-agent tribunal) if an API key is available,
 * StubSurgeon otherwise.
 * The PoC server calls this once at startup; tests inject StubSurgeon directly.
 * GeminiSurgeon remains exported for single-agent test injection.
 */
export function createSurgeon(apiKey?: string): ISurgeon {
  const key = apiKey ?? process.env['GOOGLE_API_KEY'] ?? '';
  if (key.length > 0) {
    return new TribunalSurgeon(key);
  }
  console.warn('[Surgeon] No GOOGLE_API_KEY found — falling back to StubSurgeon');
  return new StubSurgeon();
}
