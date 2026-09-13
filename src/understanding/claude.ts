import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "../config.js";
import { UnderstandingSchema } from "./schema.js";
import { buildSystemPrompt, TASK_INSTRUCTION } from "./prompt.js";
import type { Understander, UnderstandInput, UnderstandResult } from "./types.js";

export class ClaudeUnderstander implements Understander {
  readonly name = "claude";
  private client: Anthropic;

  constructor() {
    // Resolves ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
    this.client = new Anthropic();
  }

  async understand({ history, message, products }: UnderstandInput): Promise<UnderstandResult> {
    const started = Date.now();

    const messages: Anthropic.MessageParam[] = [
      ...history.map((turn) => ({
        role: (turn.role === "customer" ? "user" : "assistant") as "user" | "assistant",
        content: turn.text,
      })),
      { role: "user" as const, content: message },
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
