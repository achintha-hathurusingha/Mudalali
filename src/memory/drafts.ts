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
  delivered_at: string | null;
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
       returning id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status, delivered_at`,
      [id, args.conversationId, args.customerJid, args.incomingBody, args.draftReply, args.intent, args.orderId ?? null],
    ))!;
  }
  throw new Error("Could not allocate a draft code");
}

export async function getPendingDraft(id: string): Promise<PendingDraft | null> {
  return one<PendingDraft>(
    `select id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status, delivered_at
       from pending_drafts where id = $1 and status = 'pending'`,
    [id.toLowerCase()],
  );
}

/**
 * Records the decision. `delivered` is true only when the reply has already
 * been put on the wire - the WhatsApp command path sends first, then resolves.
 * The admin console cannot send, so it leaves the row for the outbox.
 */
export async function resolveDraft(
  id: string,
  status: "sent" | "edited" | "skipped",
  delivered = false,
): Promise<void> {
  await query(
    `update pending_drafts
        set status = $1, resolved_at = now(),
            delivered_at = case when $2::boolean then now() else delivered_at end
      where id = $3`,
    [status, delivered, id.toLowerCase()],
  );
}

/**
 * Decisions made somewhere the sender could not reach - the admin console.
 * A skip is a decision to say nothing, so it is never in here.
 */
export async function undeliveredDecisions(limit = 20): Promise<PendingDraft[]> {
  return query<PendingDraft>(
    `select id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status, delivered_at
       from pending_drafts
      where delivered_at is null
        and status in ('sent', 'edited')
      order by resolved_at
      limit $1`,
    [limit],
  );
}

/** Claims a row for sending. False when another process got there first. */
export async function claimForDelivery(id: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update pending_drafts set delivered_at = now()
      where id = $1 and delivered_at is null
      returning id`,
    [id],
  );
  return row !== null;
}

/** Puts a row back when the send failed, so the next pass retries it. */
export async function releaseDelivery(id: string): Promise<void> {
  await query(`update pending_drafts set delivered_at = null where id = $1`, [id]);
}

export async function listPendingDrafts(limit = 10): Promise<PendingDraft[]> {
  return query<PendingDraft>(
    `select id, conversation_id, customer_jid, incoming_body, draft_reply, intent, order_id, status, delivered_at
       from pending_drafts where status = 'pending' order by created_at limit $1`,
    [limit],
  );
}
