/**
 * One way to ask Gemini for a JSON answer. A model that is overloaded or out of quota is skipped
 * for the next one in the list, so a busy model slows a request down instead of failing it.
 */

/** Tried in this order. The first is the project's choice. The others answer when it is busy. */
export const GEMINI_MODELS = ['gemini-4-hydrogen', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite'] as const;

export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiOptions {
  models?: readonly string[];
  /** How long each model gets before the next one is tried. */
  attemptMs?: number;
  temperature?: number;
}

/** "Not now" or "not this model": worth trying another. Anything else is a bad request and would fail everywhere. */
const unavailable = (status: number) => status === 404 || status === 408 || status === 429 || status >= 500;

export async function askGemini(
  key: string, parts: GeminiPart[], responseSchema: object, options: GeminiOptions = {},
): Promise<{ model: string; answer: unknown }> {
  let failure = 'Gemini has no model to ask';
  for (const model of options.models ?? GEMINI_MODELS) {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        signal: AbortSignal.timeout(options.attemptMs ?? 20_000),
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: 'application/json', responseSchema,
            ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          },
        }),
      });
    } catch {
      failure = `${model} did not answer in time`;
      continue;
    }
    if (!response.ok) {
      failure = `${model} answered ${response.status}`;
      if (unavailable(response.status)) continue;
      throw new Error(failure);
    }
    const body = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const text = body.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? '').join('');
    if (!text) {
      failure = `${model} returned no answer`;
      continue;
    }
    return { model, answer: JSON.parse(text) };
  }
  throw new Error(failure);
}
