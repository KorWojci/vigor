import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callGemini, parseJsonResponse } from "@/lib/ai/gemini";

describe("callGemini", () => {
  it("posts the system instruction and prompt, and extracts the text from a successful response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Great week!" }] }, finishReason: "STOP" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await callGemini("week data here", "You are a helper.", "test-key", "gemini-3.1-flash-lite");
      expect(result).toEqual({ text: "Great week!", finishReason: "STOP" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toContain("gemini-3.1-flash-lite:generateContent?key=test-key");
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.contents[0].parts[0].text).toBe("week data here");
      expect(body.systemInstruction.parts[0].text).toBe("You are a helper.");
      expect(body.generationConfig.responseMimeType).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sets responseMimeType when jsonMode is requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await callGemini("x", "sys", "key", "model", { jsonMode: true });
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      expect(body.generationConfig.responseMimeType).toBe("application/json");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws a clear error when the prompt is blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) }));
    try {
      await expect(callGemini("x", "sys", "key", "model")).rejects.toThrow(/blocked.*SAFETY/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("throws on a non-OK HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }));
    try {
      await expect(callGemini("x", "sys", "key", "model")).rejects.toThrow(/429/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("parseJsonResponse", () => {
  const schema = z.object({ a: z.number() });

  it("parses and validates well-formed JSON", () => {
    expect(parseJsonResponse('{"a": 1}', schema, "Test")).toEqual({ a: 1 });
  });

  it("strips markdown code fences before parsing", () => {
    expect(parseJsonResponse('```json\n{"a": 2}\n```', schema, "Test")).toEqual({ a: 2 });
  });

  it("throws a clear error for invalid JSON", () => {
    expect(() => parseJsonResponse("not json", schema, "Test")).toThrow(/did not return valid JSON/);
  });

  it("throws a clear error when the shape doesn't match the schema", () => {
    expect(() => parseJsonResponse('{"a": "not a number"}', schema, "Test")).toThrow(/Test/);
  });
});
