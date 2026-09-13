/**
 * Seeds the settings table from the current .env, but only for keys that have
 * no row yet. Running it twice never overwrites a value the owner has changed.
 *
 *   npm run db:settings
 */
import { config } from "../src/config.js";
import { readSetting, setSetting, type SettingKey } from "../src/memory/settings.js";
import { closeDb } from "../src/memory/db.js";

const fromEnv: Record<SettingKey, string> = {
  paused: "false",
  mode: config.mode,
  autoIntents: config.autoIntents.join(","),
  minConfidence: String(config.minConfidence),
  autoReplyMedia: String(config.autoReplyMedia),
  autoAckEscalations: String(config.autoAckEscalations),
  debounceMs: String(config.debounceMs),
  historyTurns: String(config.historyTurns),
};

let seeded = 0;
for (const [key, value] of Object.entries(fromEnv) as Array<[SettingKey, string]>) {
  if ((await readSetting(key)) !== null) {
    console.log(`  ${key.padEnd(20)} already set, left alone`);
    continue;
  }
  await setSetting(key, value, "seed from .env");
  console.log(`  ${key.padEnd(20)} ${value}`);
  seeded++;
}

console.log(`\nseeded ${seeded} setting(s).`);
await closeDb();
