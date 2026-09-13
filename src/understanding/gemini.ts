import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "../config.js";
import { UnderstandingSchema } from "./schema.js";
import { buildSystemPrompt, TASK_INSTRUCTION } from "./prompt.js";
import type { Understander, UnderstandInput, UnderstandResult } from "./types.js";

const responseJsonSchema = (() => {
  const schema = z.toJSONSchema(UnderstandingSchema, { io: "output" }) as Record<string, unknown>;
  delete schema["$schema"];
  return schema;
})();

export class GeminiUnderstander implements Understander {
  readonly name = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey = process.env.GEMINI_API_KEY) {
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");
    this.client = new GoogleGenAI({ apiKey });
  }

  async understand({ history, message, products }: UnderstandInput): Promise<UnderstandResult> {
    const started = Date.now();

    const contents = [
      ...history.map((turn) => ({
        role: turn.role === "customer" ? "user" : "model",
        parts: [{ text: turn.text }],
      })),
      { role: "user", parts: [{ text: message }] },
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
