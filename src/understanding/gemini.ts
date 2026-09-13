import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "../config.js";
import { UnderstandingSchema } from "./schema.js";
import { buildSystemPrompt, TASK_INSTRUCTION } from "./prompt.js";
import type { Capabilities, Understander, UnderstandInput, UnderstandResult } from "./types.js";

const responseJsonSchema = (() => {
  const schema = z.toJSONSchema(UnderstandingSchema, { io: "output" }) as Record<string, unknown>;
  delete schema["$schema"];
  return schema;
})();

export class GeminiUnderstander implements Understander {
  readonly name = "gemini";
  /** Gemini reads images and audio inline, including ogg/opus voice notes. */
  readonly capabilities: Capabilities = { image: true, audio: true };
  private client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    this.client = new GoogleGenAI({ apiKey });
  }

  async understand({ history, message, media, products }: UnderstandInput): Promise<UnderstandResult> {
    const started = Date.now();

    // History is text: earlier media was reduced to a transcript or description
    // when it arrived, so only the new turn ever carries bytes.
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      ...(media ?? []).map((m) => ({
        inlineData: { mimeType: m.mimeType, data: m.data.toString("base64") },
      })),
    ];
    parts.push({ text: message || describeBareMedia(media) });

    const contents = [
      ...history.map((turn) => ({
        role: turn.role === "customer" ? "user" : "model",
        parts: [{ text: turn.text }],
      })),
      { role: "user", parts },
    ];

    const response = await this.client.models.generateContent({
      model: config.geminiModel,
      contents,
      config: {
        systemInstruction: `${buildSystemPrompt(products)}\n\n## Task\n\n${TASK_INSTRUCTION}`,
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0,
      },
    });

    const text = response.text;
    if (!text) throw new Error("Gemini returned no text");

    return {
      understanding: UnderstandingSchema.parse(JSON.parse(text)),
      model: config.geminiModel,
      latencyMs: Date.now() - started,
    };
  }
}

/** A photo or voice note with no caption still needs a text part. */
function describeBareMedia(media: UnderstandInput["media"]): string {
  const kinds = new Set((media ?? []).map((m) => (m.kind === "audio" ? "voice note" : "photo")));
  return kinds.size ? `(the customer sent a ${[...kinds].join(" and a ")} with no text)` : "";
}
