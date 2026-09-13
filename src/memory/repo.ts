import { config } from "../config.js";
import { query, one } from "./db.js";
import { canonicalCity } from "../knowledge/business.js";
import type { Understanding } from "../understanding/schema.js";
import type { Turn } from "../understanding/types.js";

export type Customer = {
  id: number;
  wa_jid: string;
  name: string | null;
  city: string | null;
};
export type Conversation = { id: number; customer_id: number; status: string };

/** One conversation per customer, reopened rather than duplicated. */
export async function getOrCreateConversation(
  waJid: string,
  pushName?: string,
): Promise<{ customer: Customer; conversation: Conversation }> {
  const phone = waJid.split("@")[0] ?? null;

  const customer = (await one<Customer>(
    `insert into customers (wa_jid, phone, name) values ($1, $2, $3)
       on conflict (wa_jid) do update set name = coalesce(customers.name, excluded.name)
       returning id, wa_jid, name, city`,
    [waJid, phone, pushName ?? null],
  ))!;

  const existing = await one<Conversation>(
    `select id, customer_id, status from conversations
      where customer_id = $1 and status = 'open'
      order by last_message_at desc limit 1`,
    [customer.id],
  );
  if (existing) return { customer, conversation: existing };

  const conversation = (await one<Conversation>(
    `insert into conversations (customer_id) values ($1) returning id, customer_id, status`,
    [customer.id],
  ))!;
  return { customer, conversation };
}

export async function recentTurns(conversationId: number, limit = config.historyTurns): Promise<Turn[]> {
  const rows = await query<{ direction: "in" | "out"; body: string }>(
    `select direction, body from messages
      where conversation_id = $1 order by id desc limit $2`,
    [conversationId, limit],
  );
  return rows
    .reverse()
    .map((r) => ({ role: r.direction === "in" ? ("customer" as const) : ("shop" as const), text: r.body }));
}

/**
 * Writes the inbound message before the model runs, so a crash mid-call never
 * loses it. Returns null when WhatsApp has redelivered something we already
 * have - the unique index on wa_message_id is what makes that reliable.
 */
export async function recordInbound(args: {
  conversationId: number;
  body: string;
  waMessageId?: string;
}): Promise<number | null> {
  // Explicit check first: `on conflict ... returning` reports a conflict
  // differently across Postgres implementations, and dedupe is too important
  // to rest on that. The unique index below is the backstop for a true race.
  if (args.waMessageId) {
    const seen = await one<{ id: string }>(`select id from messages where wa_message_id = $1`, [
      args.waMessageId,
    ]);
    if (seen) return null;
  }

  const row = await one<{ id: string }>(
    `insert into messages (conversation_id, direction, body, wa_message_id)
     values ($1, 'in', $2, $3)
     on conflict (wa_message_id) do nothing
     returning id`,
    [args.conversationId, args.body, args.waMessageId ?? null],
  );
  if (!row) return null;
  await touch(args.conversationId);
  return Number(row.id);
}

/** Fills in what the model made of a message already on disk. */
export async function annotateInbound(args: {
  messageId: number;
  understanding: Understanding;
  model: string;
  latencyMs: number;
}): Promise<void> {
  const u = args.understanding;
  await query(
    `update messages set intent = $1, confidence = $2, entities = $3,
            needs_human = $4, language = $5, model = $6, latency_ms = $7
      where id = $8`,
    [
      u.intent,
      u.confidence,
      JSON.stringify(u.entities),
      u.needsHuman,
      u.language,
      args.model,
      args.latencyMs,
      args.messageId,
    ],
  );
}

/**
 * Records an outbound turn. Used for replies the bot sends AND for replies the
 * shop owner types on their own phone - without the second kind, the model
 * reads a history where the shop said nothing and contradicts the human.
 */
export async function saveOutbound(conversationId: number, body: string, waMessageId?: string): Promise<void> {
  await query(
    `insert into messages (conversation_id, direction, body, wa_message_id)
     values ($1, 'out', $2, $3)
     on conflict (wa_message_id) do nothing`,
    [conversationId, body, waMessageId ?? null],
  );
  await touch(conversationId);
}

async function touch(conversationId: number): Promise<void> {
  await query(`update conversations set last_message_at = now() where id = $1`, [conversationId]);
}

/** Remember what the customer tells us about themselves, once. */
export async function rememberCustomerDetails(
  customer: Customer,
  details: { customerName: string | null; city: string | null },
): Promise<void> {
  const city = canonicalCity(details.city);
  const updates: string[] = [];
  const params: unknown[] = [];

  if (details.customerName && !customer.name) {
    params.push(details.customerName);
    updates.push(`name = $${params.length}`);
  }
  if (city && !customer.city) {
    params.push(city);
    updates.push(`city = $${params.length}`);
  }
  if (updates.length === 0) return;

  params.push(customer.id);
  await query(`update customers set ${updates.join(", ")} where id = $${params.length}`, params);
}

export async function findCustomerByPhone(phone: string): Promise<Customer | null> {
  return one<Customer>(
    `select id, wa_jid, name, city from customers where phone = $1 or wa_jid like $2 limit 1`,
    [phone, `${phone}@%`],
  );
}

export async function openConversationFor(customerId: number): Promise<Conversation | null> {
  return one<Conversation>(
    `select id, customer_id, status from conversations
      where customer_id = $1 and status = 'open' order by last_message_at desc limit 1`,
    [customerId],
  );
}
