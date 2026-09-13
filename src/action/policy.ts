import type { RuntimeSettings } from "../memory/settings.js";
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

export function decide(u: Understanding, settings: RuntimeSettings): Decision {
  if (u.needsHuman || ALWAYS_HUMAN.has(u.intent)) {
    return {
      action: "escalate",
      holdingReply: u.draftReply,
      reason: u.needsHumanReason ?? `intent '${u.intent}' always goes to a human`,
    };
  }

  if (u.confidence < settings.minConfidence) {
    return {
      action: "suggest",
      reply: u.draftReply,
      reason: `low confidence (${u.confidence.toFixed(2)} < ${settings.minConfidence})`,
    };
  }

  // Capturing an order needs a human. Talking about ordering does not.
  //
  // Gating on the intent alone silenced real customers: deep in an order
  // conversation the model reads a bare "Hi" or "thank you" as place_order, and
  // a greeting would then sit unanswered forever. orderReady is the same
  // condition that writes an order row, so the human check now lands exactly
  // where an order is actually being made.
  if (u.intent === "place_order" && u.orderReady) {
    return { action: "suggest", reply: u.draftReply, reason: "order capture always needs confirmation" };
  }

  if (settings.mode === "auto" && settings.autoIntents.includes(u.intent)) {
    return { action: "auto_reply", reply: u.draftReply };
  }

  return {
    action: "suggest",
    reply: u.draftReply,
    reason: settings.mode === "suggest" ? "suggest-only mode" : `'${u.intent}' is not in the auto list`,
  };
}
