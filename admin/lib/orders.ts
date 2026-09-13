import { query } from "@/lib/db";

/**
 * Server-only order reads. Client components must never import this file -
 * it pulls in lib/db, and therefore `pg` and `node:fs`, which Turbopack
 * reports as a missing build manifest rather than as what it is.
 *
 * The shapes below are mirrored inline in app/orders/order-list.tsx. The page
 * hands these rows straight to that client component, so TypeScript checks the
 * two definitions against each other at that boundary - if one drifts, the
 * page stops compiling.
 */

/** The four statuses the agent writes. A row could hold something else; the UI shows it rather than hiding it. */
export const ORDER_STATUSES = ["draft", "confirmed", "shipped", "cancelled"] as const;

/** How many orders the list loads. The summary counts are always database-wide. */
const LIST_LIMIT = 200;

export type OrderLine = {
  id: number;
  productId: string | null;
  productName: string;
  size: string | null;
  colour: string | null;
  quantity: number;
  unitPriceLkr: number;
  lineTotalLkr: number;
};

export type Order = {
  id: number;
  status: string;
  createdAt: string;
  createdLabel: string;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  itemsTotalLkr: number;
  deliveryFeeLkr: number;
  totalLkr: number;
  lines: OrderLine[];
  /** Shipping details the agent has not collected yet. Empty means ready to confirm. */
  missing: string[];
};

export type OrderSummary = {
  /** Keyed by raw status string, so an unexpected status still shows up in the total. */
  counts: Record<string, number>;
  total: number;
  /** Confirmed but not yet shipped: what the courier is being handed today. */
  awaitingCourierLkr: number;
  /** True when there are more orders than the list loaded. */
  truncated: boolean;
  listed: number;
};

/**
 * The same four fields the agent checks before it will confirm an order, in
 * the same words. See src/memory/orders.ts, missingFor().
 */
export function missingShippingFields(row: {
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
}): string[] {
  const missing: string[] = [];
  if (!row.customer_name?.trim()) missing.push("name");
  if (!row.phone?.trim()) missing.push("phone");
  if (!row.address?.trim()) missing.push("address");
  if (!row.city?.trim()) missing.push("city");
  return missing;
}

/** Fixed locale and timezone: formatted on the server so it cannot disagree with the browser on hydration. */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Colombo",
});

type OrderRow = {
  id: number;
  status: string;
  created_at: Date;
  customer_name: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  delivery_fee_lkr: number | null;
  total_lkr: number | null;
};

type ItemRow = {
  id: number;
  order_id: number;
  product_id: string | null;
  product_name: string | null;
  size: string | null;
  colour: string | null;
  quantity: number;
  unit_price_lkr: number;
};

/**
 * Two queries, never one per order: the orders, then every line belonging to
 * them, grouped in JS.
 */
export async function listOrders(): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `select id, status, created_at, customer_name, phone, city, address,
            delivery_fee_lkr, total_lkr
       from orders
      order by created_at desc, id desc
      limit $1`,
    [LIST_LIMIT],
  );
  if (rows.length === 0) return [];

  const items = await query<ItemRow>(
    `select i.id, i.order_id, i.product_id, i.size, i.colour, i.quantity,
            i.unit_price_lkr, c.name as product_name
       from order_items i
       left join catalog c on c.id = i.product_id
      where i.order_id = any($1::int[])
      order by i.id`,
    [rows.map((r) => r.id)],
  );

  const byOrder = new Map<number, OrderLine[]>();
  for (const item of items) {
    const line: OrderLine = {
      id: item.id,
      productId: item.product_id,
      // A product deleted from the catalog must not erase the line it was sold on.
      productName: item.product_name ?? item.product_id ?? "Unknown product",
      size: item.size,
      colour: item.colour,
      quantity: item.quantity,
      unitPriceLkr: item.unit_price_lkr,
      lineTotalLkr: item.quantity * item.unit_price_lkr,
    };
    const existing = byOrder.get(item.order_id);
    if (existing) existing.push(line);
    else byOrder.set(item.order_id, [line]);
  }

  return rows.map((row) => {
    const lines = byOrder.get(row.id) ?? [];
    const itemsTotal = lines.reduce((sum, l) => sum + l.lineTotalLkr, 0);
    const delivery = row.delivery_fee_lkr ?? 0;
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      createdLabel: WHEN.format(row.created_at),
      customerName: row.customer_name,
      phone: row.phone,
      address: row.address,
      city: row.city,
      itemsTotalLkr: itemsTotal,
      deliveryFeeLkr: delivery,
      // The agent stores a total; fall back to the lines if it never wrote one.
      totalLkr: row.total_lkr ?? itemsTotal + delivery,
      lines,
      missing: missingShippingFields(row),
    };
  });
}

/**
 * Counts and money across every order, not just the page being shown - the
 * courier number has to be right even when the list is capped.
 */
export async function readOrderSummary(listed: number): Promise<OrderSummary> {
  const rows = await query<{ status: string; count: number; value_lkr: number }>(
    `select o.status,
            count(*)::int as count,
            coalesce(sum(coalesce(o.total_lkr,
                                  i.items_total + coalesce(o.delivery_fee_lkr, 0),
                                  0)), 0)::int as value_lkr
       from orders o
       left join (select order_id, sum(quantity * unit_price_lkr)::int as items_total
                    from order_items group by order_id) i on i.order_id = o.id
      group by o.status`,
  );

  const counts: Record<string, number> = {};
  let total = 0;
  let awaitingCourierLkr = 0;
  for (const row of rows) {
    counts[row.status] = row.count;
    total += row.count;
    if (row.status === "confirmed") awaitingCourierLkr = row.value_lkr;
  }

  return { counts, total, awaitingCourierLkr, truncated: listed < total, listed };
}
