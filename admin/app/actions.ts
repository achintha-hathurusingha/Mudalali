"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSession, destroySession, isSignedIn, passwordIsCorrect } from "@/lib/auth";
import { writeSetting } from "@/lib/settings";
import type { SettingKey } from "@/lib/settings-shared";

export async function signIn(_state: { error?: string }, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (!passwordIsCorrect(password)) {
    return { error: "Wrong password." };
  }
  await createSession();
  redirect("/settings");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}

/**
 * Writes one setting. The agent picks it up on its next customer message -
 * within a few seconds - with no restart and no deploy.
 */
export async function updateSetting(key: SettingKey, value: string) {
  // Flipping mode to auto or clearing the pause reaches customers with no
  // further step, so this does not rest on `proxy.ts` alone.
  if (!(await isSignedIn())) throw new Error("Not signed in.");

  await writeSetting(key, value, "console");
  revalidatePath("/settings");
}
