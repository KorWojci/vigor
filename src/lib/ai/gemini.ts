import type { z } from "zod";

/**
 * The only module that makes a network call anywhere in Vigor (see CLAUDE.md invariant 9) —
 * shared by the weekly recap and the per-workout rating, both of which only ever run when the
 * user explicitly clicks Generate/Regenerate.
 */
export interface GeminiResult {
  text: string;
  finishReason: string | null;
}

export async function callGemini(
  prompt: string,
  systemInstructions: string,
  apiKey: string,
  model: string,
  opts: { jsonMode?: boolean; maxOutputTokens?: number; temperature?: number } = {},
): Promise<GeminiResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstructions }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: opts.maxOutputTokens ?? 800,
        temperature: opts.temperature ?? 0.4,
        ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error(`Gemini returned no text (finishReason: ${candidate?.finishReason ?? "unknown"})`);
  return { text, finishReason: candidate?.finishReason ?? null };
}

/** Parses and validates a JSON-mode Gemini response against a Zod schema, never silently coercing a bad shape. */
export function parseJsonResponse<T>(text: string, schema: z.ZodType<T>, label: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`${label}: Gemini did not return valid JSON.`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(`${label}: Gemini's response didn't match the expected shape (${result.error.issues[0]?.message ?? "validation failed"}).`);
  return result.data;
}
