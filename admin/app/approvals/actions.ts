"use server";

import { revalidatePath } from "next/cache";
import { isSignedIn } from "@/lib/auth";
import { resolveDraft, saveEditedDraft } from "@/lib/approvals";

/**
 * Approvals record a decision. They do not send anything.
 *
 * The agent process owns the WhatsApp connection; it reads `pending_drafts`
 * and delivers the reply itself. All this console does is write the status -
 * and, for an edit, the wording the agent should use instead.
 */

type Decision = { ok: true } | { ok: false; reason: string };

const ALREADY_ANSWERED = "That draft was already answered somewhere else.";

/**
 * Server actions are public POST endpoints. `proxy.ts` gates them, but an
 * approval is the single most outward-facing thing this console does - it puts
 * a message in front of a real customer on WhatsApp - so it does not rest on
 * one layer.
 */
const EXPIRED = "Your session has expired. Reload the page and sign in again.";

async function denyIfSignedOut(): Promise<Decision | null> {
  if (await isSignedIn()) return null;
  return { ok: false, reason: EXPIRED };
}

/** Draft ids are the 4-character codes the owner used to type into WhatsApp. */
function draftId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[a-z0-9]{1,16}$/i.test(id) ? id : null;
}

export async function approveDraft(id: unknown): Promise<Decision> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const key = draftId(id);
  if (!key) return { ok: false, reason: "That is not a draft code." };

  const written = await resolveDraft(key, "sent");
  revalidatePath("/approvals");
  return written ? { ok: true } : { ok: false, reason: ALREADY_ANSWERED };
}

export async function skipDraft(id: unknown): Promise<Decision> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const key = draftId(id);
  if (!key) return { ok: false, reason: "That is not a draft code." };

  const written = await resolveDraft(key, "skipped");
  revalidatePath("/approvals");
  return written ? { ok: true } : { ok: false, reason: ALREADY_ANSWERED };
}

export async function editDraft(id: unknown, reply: unknown): Promise<Decision> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const key = draftId(id);
  if (!key) return { ok: false, reason: "That is not a draft code." };

  const text = typeof reply === "string" ? reply.trim() : "";
  if (text === "") return { ok: false, reason: "An empty reply is a skip, not an edit." };
  // WhatsApp itself stops well short of this; the cap is only here so a stuck
  // paste cannot write a megabyte into the row the agent is about to send.
  if (text.length > 4000) return { ok: false, reason: "That reply is too long to send as one message." };

  const written = await saveEditedDraft(key, text);
  revalidatePath("/approvals");
  return written ? { ok: true } : { ok: false, reason: ALREADY_ANSWERED };
}
