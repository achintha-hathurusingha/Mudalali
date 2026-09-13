import { query, one } from "./db.js";
import { deliveryFeeFor, canonicalCity } from "../knowledge/business.js";
import { loadCatalog, type Product } from "../knowledge/catalog.js";
import type { Understanding, OrderItem } from "../understanding/schema.js";

export type ValidatedLine = {
  product: Product;
  size: string | null;
  colour: string | null;
  quantity: number;
};

export type DraftOrder = {
  id: number;
  lines: ValidatedLine[];
  itemsTotalLkr: number;
  deliveryFeeLkr: number;
  totalLkr: number;
  city: string | null;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  /** What still has to be collected before this can ship. */
  missing: string[];
};

export function missingFor(order: {
  customerName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
}): string[] {
  const missing: string[] = [];
  if (!order.customerName) missing.push("name");
  if (!order.phone) missing.push("phone");
  if (!order.address) missing.push("address");
  if (!order.city) missing.push("city");
  return missing;
}

/** Why an order could not be created. The operator needs to see these. */
export type OrderProblem = { item: string; reason: string };

export type OrderResult =
  | { ok: true; order: DraftOrder }
  | { ok: false; problems: OrderProblem[] };

function validateLine(item: OrderItem, product: Product): OrderProblem | null {
  const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;

  if (product.stock <= 0) {
    return { item: product.name, reason: "out of stock" };
  }
  if (quantity > product.stock) {
    return { item: product.name, reason: `only ${product.stock} left, asked for ${quantity}` };
  }
  if (item.size && product.sizes.length > 0 && !product.sizes.includes(item.size)) {
    return { item: product.name, reason: `size ${item.size} not offered (has ${product.sizes.join(", ")})` };
  }
  if (item.colour && product.colours.length > 0 && !matchesColour(item.colour, product.colours)) {
    return { item: product.name, reason: `colour ${item.colour} not offered (has ${product.colours.join(", ")})` };
  }
  return null;
}

function matchesColour(colour: string, available: string[]): boolean {
  return available.some((c) => c.toLowerCase() === colour.trim().toLowerCase());
}

/**
 * Orders are never auto-confirmed. This writes a draft the operator confirms,
 * so a misread message costs a tap, not a shipment. Anything the catalog
 * cannot honour is refused here rather than written and discovered later.
 */
export async function createDraftOrder(args: {
  customerId: number;
  conversationId: number;
  understanding: Understanding;
}): Promise<OrderResult | null> {
  const { entities } = args.understanding;
  const catalog = await loadCatalog();

  const lines: ValidatedLine[] = [];
  const problems: OrderProblem[] = [];

  for (const item of entities.items) {
    if (!item.productId) continue;
    const product = catalog.find((p) => p.id === item.productId);
    if (!product) {
      problems.push({ item: item.productName ?? item.productId, reason: "not in the catalog" });
      continue;
    }
    const problem = validateLine(item, product);
    if (problem) {
      problems.push(problem);
      continue;
    }
    lines.push({
      product,
      size: item.size,
      colour: item.colour,
      quantity: item.quantity && item.quantity > 0 ? item.quantity : 1,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  if (lines.length === 0) return null;

  const itemsTotal = lines.reduce((sum, l) => sum + l.product.priceLkr * l.quantity, 0);
  const city = canonicalCity(entities.city);
  const deliveryFee = deliveryFeeFor(entities.city, itemsTotal);
  const total = itemsTotal + deliveryFee;

  // A conversation has at most ONE open order. Every later turn refines it -
  // otherwise "L size black" then "ow ewanna, here is my address" writes two
  // orders and the shop ships twice.
  const open = await one<{
    id: number;
    customer_name: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
  }>(
    `select id, customer_name, phone, address, city from orders
      where conversation_id = $1 and status = 'draft' order by id desc limit 1`,
    [args.conversationId],
  );

  // Details already collected are never dropped by a later, vaguer turn.
  const customerName = entities.customerName ?? open?.customer_name ?? null;
  const phone = entities.phone ?? open?.phone ?? null;
  const address = entities.addressLine ?? open?.address ?? null;
  const finalCity = city ?? open?.city ?? null;
  const finalFee = deliveryFeeFor(finalCity, itemsTotal);
  const finalTotal = itemsTotal + finalFee;

  let orderId: number;
  if (open) {
    await query(
      `update orders set customer_name = $1, phone = $2, city = $3, address = $4,
              delivery_fee_lkr = $5, total_lkr = $6 where id = $7`,
      [customerName, phone, finalCity, address, finalFee, finalTotal, open.id],
    );
    await query(`delete from order_items where order_id = $1`, [open.id]);
    orderId = open.id;
  } else {
    const created = (await one<{ id: number }>(
      `insert into orders
         (customer_id, conversation_id, status, customer_name, phone, city, address, delivery_fee_lkr, total_lkr)
       values ($1, $2, 'draft', $3, $4, $5, $6, $7, $8) returning id`,
      [args.customerId, args.conversationId, customerName, phone, finalCity, address, finalFee, finalTotal],
    ))!;
    orderId = created.id;
  }

  for (const line of lines) {
    await query(
      `insert into order_items (order_id, product_id, size, colour, quantity, unit_price_lkr)
       values ($1, $2, $3, $4, $5, $6)`,
      [orderId, line.product.id, line.size, line.colour, line.quantity, line.product.priceLkr],
    );
  }

  const details = { customerName, phone, address, city: finalCity };
  return {
    ok: true,
    order: {
      id: orderId,
      lines,
      itemsTotalLkr: itemsTotal,
      deliveryFeeLkr: finalFee,
      totalLkr: finalTotal,
      ...details,
      missing: missingFor(details),
    },
  };
}

/** An order can only be confirmed when it has somewhere to ship to. */
export async function orderReadyToConfirm(orderId: number): Promise<string[]> {
  const row = await one<{
    customer_name: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
  }>(`select customer_name, phone, address, city from orders where id = $1`, [orderId]);
  if (!row) return ["order not found"];
  return missingFor({
    customerName: row.customer_name,
    phone: row.phone,
    address: row.address,
    city: row.city,
  });
}

export async function confirmOrder(orderId: number): Promise<void> {
  await query(`update orders set status = 'confirmed' where id = $1 and status = 'draft'`, [orderId]);
}

export async function cancelOrder(orderId: number): Promise<void> {
  await query(`update orders set status = 'cancelled' where id = $1 and status = 'draft'`, [orderId]);
}

export function renderOrder(order: DraftOrder): string {
  const lines = order.lines.map((l) => {
    const variant = [l.size, l.colour].filter(Boolean).join(" / ");
    return `  ${l.quantity} x ${l.product.name}${variant ? ` (${variant})` : ""} - Rs. ${l.product.priceLkr * l.quantity}`;
  });

  const missing: string[] = [];
  if (!order.customerName) missing.push("name");
  if (!order.phone) missing.push("phone");
  if (!order.address) missing.push("address");
  if (!order.city) missing.push("city");

  return [
    `order #${order.id}`,
    ...lines,
    `  items Rs. ${order.itemsTotalLkr} + delivery Rs. ${order.deliveryFeeLkr} = Rs. ${order.totalLkr}`,
    `  ${[order.customerName, order.phone].filter(Boolean).join(" / ") || "no contact yet"}`,
    `  ${[order.address, order.city].filter(Boolean).join(", ") || "no address yet"}`,
    missing.length ? `  still missing: ${missing.join(", ")}` : `  complete`,
  ].join("\n");
}

export function renderProblems(problems: OrderProblem[]): string {
  return ["cannot order:", ...problems.map((p) => `  ${p.item} - ${p.reason}`)].join("\n");
}
