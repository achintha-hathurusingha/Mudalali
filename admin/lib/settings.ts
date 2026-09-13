import { query } from "./db";
import type { SettingKey, SettingRow } from "./settings-shared";

/** Server-only settings access. Client components import ./settings-shared. */

export async function readSettings(): Promise<Record<string, SettingRow>> {
  const rows = await query<SettingRow>(
    `select key, value, updated_at, updated_by from settings order by key`,
  );
  return Object.fromEntries(rows.map((r) => [r.key, r]));
}

export async function writeSetting(key: SettingKey, value: string, updatedBy: string): Promise<void> {
  await query(
    `insert into settings (key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value,
                                       updated_at = now(),
                                       updated_by = excluded.updated_by`,
    [key, value, updatedBy],
  );
}
