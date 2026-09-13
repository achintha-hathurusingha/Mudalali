import { config } from "../config.js";
import { GeminiUnderstander } from "./gemini.js";
import { ClaudeUnderstander } from "./claude.js";
import type { Understander } from "./types.js";

export function createUnderstander(provider = config.provider): Understander {
  switch (provider) {
    case "gemini":
      return new GeminiUnderstander();
    case "claude":
      return new ClaudeUnderstander();
    default:
      throw new Error(`Unknown LLM_PROVIDER: ${provider satisfies never}`);
  }
}

export * from "./types.js";
export * from "./schema.js";
