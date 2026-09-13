import { config, type PolicyMode } from "../config.js";
import { query, one } from "./db.js";
import { log } from "../log.js";

/**
 * Settings the shop owner changes while the agent is running.
 *
 * `.env` supplies the defaults; rows in the `settings` table override them.
 * Cached briefly so this is not a query per message, but short enough that a
 * switch flipped in the console takes effect on the next customer message
 * rather than the next deploy.
 */
export type RuntimeSettings = {
  /** Stop replying to everyone, now. Messages are still recorded. */
  paused: boolean;
  mode: PolicyMode;
  autoIntents: string[];
  minConfidence: number;
  autoReplyMedia: boolean;
  autoAckEscalations: boolean;
  debounceMs: number;
  historyTurns: number;
};

/** Every key the console may write. Anything else is ignored. */
export const SETTING_KEYS = [
  "paused",
  "mode",
  "autoIntents",
  "minConfidence",
  "autoReplyMedia",
  "autoAckEscalations",
  "debounceMs",
  "historyTurns",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

const CACHE_MS = Number(process.env.SETTINGS_CACHE_MS ?? 5000);

let cache: { at: number; value: RuntimeSettings } | null = null;

function defaults(): RuntimeSettings {
  return {
    paused: false,
    mode: config.mode,
    autoIntents: [...config.autoIntents],
    minConfidence: config.minConfidence,
    autoReplyMedia: config.autoReplyMedia,
    autoAckEscalations: config.autoAckEscalations,
    debounceMs: config.debounceMs,
    historyTurns: config.historyTurns,
  };
}

function bool(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1") return true;
  if (v === "false" || v === "0") return false;
  return fallback;
}

function num(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function apply(settings: RuntimeSettings, key: string, raw: string): void {
  switch (key) {
    case "paused":
      settings.paused = bool(raw, settings.paused);
      break;
    case "mode":
      if (raw === "suggest" || raw === "auto") settings.mode = raw;
      break;
    case "autoIntents":
      settings.autoIntents = raw.split(",").map((s) => s.trim()).filter(Boolean);
      break;
    case "minConfidence":
      settings.minConfidence = num(raw, settings.minConfidence);
      break;
    case "autoReplyMedia":
      settings.autoReplyMedia = bool(raw, settings.autoReplyMedia);
      break;
    case "autoAckEscalations":
      settings.autoAckEscalations = bool(raw, settings.autoAckEscalations);
      break;
    case "debounceMs":
      settings.debounceMs = num(raw, settings.debounceMs);
      break;
    case "historyTurns":
      settings.historyTurns = num(raw, settings.historyTurns);
      break;
    default:
      // A key the console does not know about is ignored rather than crashing
      // the agent - the two deploy independently.
      log.debug({ key }, "unknown setting ignored");
  }
}

export async function getSettings(): Promise<RuntimeSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  const settings = defaults();
  try {
    const rows = await query<{ key: string; value: string }>(`select key, value from settings`);
    for (const row of rows) apply(settings, row.key, row.value);
  } catch (error) {
    // A database blip must not silently change how the agent behaves, so fall
    // back to the .env defaults and say so.
    log.error({ err: error }, "could not read settings - using .env defaults");
  }

  cache = { at: Date.now(), value: settings };
  return settings;
}

export async function setSetting(key: SettingKey, value: string, updatedBy?: string): Promise<void> {
  await query(
    `insert into settings (key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value,
                                       updated_at = now(),
                                       updated_by = excluded.updated_by`,
    [key, value, updatedBy ?? null],
  );
  invalidateSettings();
  log.info({ key, value, updatedBy }, "setting changed");
}

export async function readSetting(key: SettingKey): Promise<string | null> {
  const row = await one<{ value: string }>(`select value from settings where key = $1`, [key]);
  return row?.value ?? null;
}

/** Drop the cache so the next read hits the database. Used after a write, and by tests. */
export function invalidateSettings(): void {
  cache = null;
}
