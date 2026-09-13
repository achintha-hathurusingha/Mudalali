/**
 * Settings types and pure helpers, safe to import from client components.
 *
 * Kept separate from lib/settings.ts deliberately: that file imports `pg` and
 * `node:fs`, and a client component importing it transitively drags Postgres
 * into the browser bundle. Turbopack reports that as a missing build manifest,
 * which points nowhere near the actual cause.
 */

export type SettingKey =
  | "paused"
  | "mode"
  | "autoIntents"
  | "minConfidence"
  | "autoReplyMedia"
  | "autoAckEscalations"
  | "debounceMs"
  | "historyTurns";

export type SettingRow = {
  key: string;
  value: string;
  updated_at: string;
  updated_by: string | null;
};

/** Every intent the agent can classify. Shown as toggles, not a CSV string. */
export const INTENTS = [
  "greeting",
  "availability",
  "price",
  "variant",
  "place_order",
  "delivery",
  "payment",
  "order_status",
  "complaint_return",
  "bargaining",
  "other",
] as const;

/**
 * Intents the agent will never automate, whatever this page says. Shown so the
 * owner understands why they cannot be ticked, rather than wondering.
 */
export const NEVER_AUTOMATED = ["bargaining", "complaint_return", "order_status"] as const;

export function asBool(row: SettingRow | undefined, fallback: boolean): boolean {
  if (!row) return fallback;
  const v = row.value.trim().toLowerCase();
  return v === "true" || v === "1";
}

export function asNumber(row: SettingRow | undefined, fallback: number): number {
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : fallback;
}

export function asList(row: SettingRow | undefined): string[] {
  if (!row) return [];
  return row.value.split(",").map((s) => s.trim()).filter(Boolean);
}
