import { randomBytes } from "node:crypto";
import { query, one } from "./db.js";

export type PendingDraft = {
  id: string;
  conversation_id: number;
  customer_jid: string;
  incoming_body: string;
  draft_reply: string;
  intent: string | null;
  order_id: number | null;
  status: string;
};

function shortCode(): string {
  return randomBytes(2).toString("hex"); // 4 chars, e.g. 'a3f0'
}

export async function createDraft(args: {
  conversationId: number;
  customerJid: string;
  incomingBody: string;
  draftReply: string;
  intent: string;
  orderId?: number | null;
}): Promise<PendingDraft> {
  // Collisions are possible but cheap to retry; only pending drafts matter.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = shortCode();
    const existing = await one<{ id: string }>(`select id from pending_drafts where id = $1`, [id]);
    if (existing) continue;
    return (await one<PendingDraft>(
      `insert into pending_drafts (id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status`,
      [id, args.conversationId, args.customerJid, args.incomingBody, args.draftReply, args.intent, args.orderId ?? null],
    ))!;
  }
  throw new Error("Could not allocate a draft code");
}

export async function getPendingDraft(id: string): Promise<PendingDraft | null> {
  return one<PendingDraft>(
    `select id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status
       from pending_drafts where id = $1 and status = 'pending'`,
    [id.toLowerCase()],
  );
}

export async function resolveDraft(id: string, status: "sent" | "edited" | "skipped"): Promise<void> {
  await query(`update pending_drafts set status = $1, resolved_at = now() where id = $2`, [status, id.toLowerCase()]);
}

export async function listPendingDrafts(limit = 10): Promise<PendingDraft[]> {
  return query<PendingDraft>(
    `select id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status
       from pending_drafts where status = 'pending' order by created_at limit $1`,
    [limit],
  );
}
