import { query, one } from "@/lib/db";
import type { Draft, DraftOrder, EditRate } from "@/app/approvals/queue";

/**
 * Server-only data access for the approvals queue.
 *
 * Like lib/settings.ts this pulls in `pg`, so nothing here may be imported
 * from a client component. The shapes it returns are declared in
 * app/approvals/queue.tsx - the client file owns them, and this module borrows
 * them with a type-only import that disappears at compile time. That keeps one
 * definition without giving the browser bundle a path back to Postgres.
 */

type DraftSqlRow = {
  id: string;
  incoming_body: string | null;
  draft_reply: string | null;
  intent: string | null;
  order_id: number | null;
  created_at: Date;
  customer_jid: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  confidence: number | null;
  language: string | null;
  media_kind: string | null;
};

type OrderSqlRow = {
  id: number;
  status: string | null;
  customer_name: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  delivery_fee_lkr: number | null;
  total_lkr: number | null;
};

type OrderItemSqlRow = {
  order_id: number;
  product: string | null;
  size: string | null;
  colour: string | null;
  quantity: number | null;
  unit_price_lkr: number | null;
};

/** The shop is in Sri Lanka, so times are shown on its clock, not the server's. */
const SHOP_TIME_ZONE = "Asia/Colombo";

function clock(at: Date): string {
  return at.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: SHOP_TIME_ZONE,
  });
}

/** How long the customer has been waiting, in the shortest form that is true. */
function waited(at: Date, now: number): string {
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * `customers.phone` is filled from the WhatsApp jid, and a `...@lid` jid is an
 * opaque 15-digit id rather than a number anyone can ring. Show a phone number
 * only when it could actually be one.
 */
function contactOf(row: DraftSqlRow): string {
  const raw = (row.customer_phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 9 && digits.length <= 12) return raw;
  return "no phone on file";
}

function trimmed(value: string | null): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

async function ordersFor(ids: number[]): Promise<Map<number, DraftOrder>> {
  if (ids.length === 0) return new Map();

  const [orders, items] = await Promise.all([
    query<OrderSqlRow>(
      `select id, status, customer_name, phone, city, address, delivery_fee_lkr, total_lkr
         from orders
        where id = any($1::int[])`,
      [ids],
    ),
    query<OrderItemSqlRow>(
      `select oi.order_id,
              coalesce(k.name, oi.product_id) as product,
              oi.size,
              oi.colour,
              oi.quantity,
              oi.unit_price_lkr
         from order_items oi
         left join catalog k on k.id = oi.product_id
        where oi.order_id = any($1::int[])
        order by oi.order_id, oi.id`,
      [ids],
    ),
  ]);

  const byOrder = new Map<number, DraftOrder>();

  for (const order of orders) {
    const lines = items
      .filter((item) => item.order_id === order.id)
      .map((item) => {
        const quantity = item.quantity ?? 1;
        const variant = [item.size, item.colour].map(trimmed).filter(Boolean);
        const product = trimmed(item.product) ?? "unnamed item";
        return {
          description: `${quantity} x ${product}${variant.length ? ` - ${variant.join(", ")}` : ""}`,
          amountLkr: quantity * (item.unit_price_lkr ?? 0),
        };
      });

    // What the agent still has to ask for before this order can be despatched.
    const missing: string[] = [];
    if (!trimmed(order.customer_name)) missing.push("name");
    if (!trimmed(order.phone)) missing.push("phone");
    if (!trimmed(order.city)) missing.push("city");
    if (!trimmed(order.address)) missing.push("address");

    const itemsTotal = lines.reduce((sum, line) => sum + line.amountLkr, 0);

    byOrder.set(order.id, {
      id: order.id,
      status: trimmed(order.status) ?? "draft",
      lines,
      deliveryFeeLkr: order.delivery_fee_lkr,
      totalLkr: order.total_lkr ?? itemsTotal + (order.delivery_fee_lkr ?? 0),
      missing,
    });
  }

  return byOrder;
}

/**
 * Everything waiting on the owner, oldest first, so the queue is worked from
 * the top and whoever has waited longest is answered first.
 */
export async function listPendingDrafts(): Promise<Draft[]> {
  const rows = await query<DraftSqlRow>(
    // The confidence shown belongs to the customer message this draft answers,
    // so it is the inbound row closest to the draft - preferring one written
    // before it, since that is the message the agent actually classified.
    `select d.id,
            d.incoming_body,
            d.draft_reply,
            d.intent,
            d.order_id,
            d.created_at,
            d.customer_jid,
            c.name  as customer_name,
            c.phone as customer_phone,
            m.confidence,
            m.language,
            m.media_kind
       from pending_drafts d
       left join conversations v on v.id = d.conversation_id
       left join customers c on c.id = v.customer_id
       left join lateral (
         select confidence, language, media_kind
           from messages
          where conversation_id = d.conversation_id
            and direction = 'in'
          order by case when created_at <= d.created_at then 0 else 1 end,
                   abs(extract(epoch from created_at - d.created_at))
          limit 1
       ) m on true
      where d.status = 'pending'
      order by d.created_at asc`,
  );

  const orderIds = rows.map((row) => row.order_id).filter((id): id is number => id !== null);
  const orders = await ordersFor([...new Set(orderIds)]);
  const now = Date.now();

  return rows.map((row) => ({
    id: row.id,
    customerName: trimmed(row.customer_name) ?? "Unknown customer",
    contact: contactOf(row),
    jid: trimmed(row.customer_jid) ?? "",
    incoming: trimmed(row.incoming_body) ?? "(empty message)",
    reply: row.draft_reply ?? "",
    intent: trimmed(row.intent),
    confidence: row.confidence,
    language: trimmed(row.language),
    mediaKind: trimmed(row.media_kind),
    receivedAt: clock(row.created_at),
    waiting: waited(row.created_at, now),
    order: row.order_id === null ? null : (orders.get(row.order_id) ?? null),
  }));
}

/**
 * The edit rate: of the drafts the owner let through, how many needed
 * rewriting. Broken down by intent, because a high rate on one intent points
 * straight at the part of the prompt that is wrong.
 */
export async function readEditRates(): Promise<EditRate[]> {
  return query<EditRate>(
    `select coalesce(nullif(trim(intent), ''), 'unknown')   as intent,
            count(*) filter (where status = 'sent')::int    as sent,
            count(*) filter (where status = 'edited')::int  as edited,
            count(*) filter (where status = 'skipped')::int as skipped
       from pending_drafts
      where status in ('sent', 'edited', 'skipped')
      group by 1
      order by count(*) filter (where status in ('sent', 'edited')) desc, 1`,
  );
}

/**
 * Records a decision. Writing only where the row is still pending means a
 * second click - or the same draft answered from WhatsApp meanwhile - cannot
 * overwrite the first answer.
 */
export async function resolveDraft(id: string, status: "sent" | "skipped"): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update pending_drafts
        set status = $2, resolved_at = now()
      where id = $1 and status = 'pending'
      returning id`,
    [id, status],
  );
  return row !== null;
}

/**
 * Saves the owner's wording over the draft and marks it edited. The agent
 * sends `draft_reply`, so the rewrite has to land in that column - marking the
 * row edited without replacing the text would send the draft they rejected.
 */
export async function saveEditedDraft(id: string, reply: string): Promise<boolean> {
  const row = await one<{ id: string }>(
    `update pending_drafts
        set draft_reply = $2, status = 'edited', resolved_at = now()
      where id = $1 and status = 'pending'
      returning id`,
    [id, reply],
  );
  return row !== null;
}
