import { config } from "../config.js";
import type { Understanding } from "../understanding/schema.js";

export type Decision =
  | { action: "auto_reply"; reply: string }
  | { action: "suggest"; reply: string; reason: string }
  | { action: "escalate"; holdingReply: string; reason: string };

/**
 * Intents that are never automated, at any confidence, in any mode.
 * These are relationship moments, not classification problems.
 */
const ALWAYS_HUMAN = new Set(["bargaining", "complaint_return", "order_status"]);

export function decide(u: Understanding): Decision {
  if (u.needsHuman || ALWAYS_HUMAN.has(u.intent)) {
    return {
      action: "escalate",
      holdingReply: u.draftReply,
      reason: u.needsHumanReason ?? `intent '${u.intent}' always goes to a human`,
    };
  }

  if (u.confidence < config.minConfidence) {
    return {
      action: "suggest",
      reply: u.draftReply,
      reason: `low confidence (${u.confidence.toFixed(2)} < ${config.minConfidence})`,
    };
  }

  // Order capture always gets a human eye, even in auto mode.
  if (u.intent === "place_order") {
    return { action: "suggest", reply: u.draftReply, reason: "order capture always needs confirmation" };
  }

  if (config.mode === "auto" && config.autoIntents.includes(u.intent)) {
    return { action: "auto_reply", reply: u.draftReply };
  }

  return {
    action: "suggest",
    reply: u.draftReply,
    reason: config.mode === "suggest" ? "suggest-only mode" : `'${u.intent}' is not in AUTO_INTENTS`,
  };
}
