import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "../config.js";
import { UnderstandingSchema } from "./schema.js";
import { buildSystemPrompt, TASK_INSTRUCTION } from "./prompt.js";
import type { Capabilities, Understander, UnderstandInput, UnderstandResult } from "./types.js";

const CLAUDE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ClaudeImageType = (typeof CLAUDE_IMAGE_TYPES)[number];

export class ClaudeUnderstander implements Understander {
  readonly name = "claude";
  /** Claude reads images. There is no audio content block, so voice notes
   *  must reach a human instead of being silently dropped. */
  readonly capabilities: Capabilities = { image: true, audio: false };
  private client: Anthropic;

  constructor() {
    // Resolves ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
    this.client = new Anthropic();
  }

  async understand({ history, message, media, products }: UnderstandInput): Promise<UnderstandResult> {
    const started = Date.now();

    const images = (media ?? []).filter((m) => m.kind === "image");
    const unsupported = (media ?? []).filter((m) => m.kind !== "image");
    if (unsupported.length > 0) {
      throw new Error(`Claude cannot read ${unsupported[0]!.kind} - route this to a human`);
    }

    const content: Anthropic.ContentBlockParam[] = images.map((m) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: asClaudeImageType(m.mimeType),
        data: m.data.toString("base64"),
      },
    }));
    content.push({ type: "text", text: message || "(the customer sent a photo with no text)" });

    const messages: Anthropic.MessageParam[] = [
      ...history.map((turn) => ({
        role: (turn.role === "customer" ? "user" : "assistant") as "user" | "assistant",
        content: turn.text,
      })),
      { role: "user" as const, content },
    ];

    // First message must be from the user.
    while (messages.length > 0 && messages[0]!.role !== "user") messages.shift();

    const response = await this.client.messages.parse({
      model: config.claudeModel,
      max_tokens: 2048,
      // Catalog and business facts are the stable prefix - cache them.
      system: [
        {
          type: "text",
          text: `${buildSystemPrompt(products)}\n\n## Task\n\n${TASK_INSTRUCTION}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
      output_config: {
        effort: "low",
        format: zodOutputFormat(UnderstandingSchema),
      },
    });

    if (response.stop_reason === "refusal") {
      throw new Error(`Claude refused: ${response.stop_details?.explanation ?? "no explanation"}`);
    }
    if (!response.parsed_output) {
      throw new Error("Claude returned no parsable structured output");
    }

    return {
      understanding: response.parsed_output,
      model: config.claudeModel,
      latencyMs: Date.now() - started,
    };
  }
}

function asClaudeImageType(mimeType: string): ClaudeImageType {
  const normalised = mimeType === "image/jpg" ? "image/jpeg" : mimeType;
  if ((CLAUDE_IMAGE_TYPES as readonly string[]).includes(normalised)) return normalised as ClaudeImageType;
  throw new Error(`Claude does not accept ${mimeType}`);
}
