"use server";

import { revalidatePath } from "next/cache";
import { one } from "@/lib/db";
import { missingShippingFields } from "@/lib/orders";

/**
 * Order transitions. Every one of them is guarded on the status it expects, so
 * two tabs open on the same order cannot ship it twice or resurrect a
 * cancellation.
 */

type Result = { ok: boolean; message: string; description?: string };

function asId(orderId: number): number | null {
  return Number.isInteger(orderId) && orderId > 0 ? orderId : null;
}

/**
 * The order moved while the screen was open - the agent collected an address,
 * or another tab acted first. Refuse, but repaint, so the owner is not left
 * looking at a button that will keep failing.
 */
function stale(message: string, description?: string): Result {
  revalidatePath("/orders");
  return { ok: false, message, description };
}

/** "address" / "address and city" / "phone, address and city" */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

type StatusRow = {
  status: string;
  customer_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
};

/**
 * Confirming is the one transition with a precondition. The agent refuses to
 * confirm an order it has no address for; this refuses for the same reason and
 * says which fields are still open, because the fix is a WhatsApp message, not
 * a form on this page.
 */
export async function confirmOrder(orderId: number): Promise<Result> {
  const id = asId(orderId);
  if (!id) return { ok: false, message: "That is not an order." };

  const row = await one<StatusRow>(
    `select status, customer_name, phone, address, city from orders where id = $1`,
    [id],
  );
  if (!row) return stale(`Order #${id} no longer exists.`);
  if (row.status !== "draft") {
    return stale(`Order #${id} is already ${row.status}.`);
  }

  const missing = missingShippingFields(row);
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Order #${id} has no ${listWords(missing)}.`,
      description:
        "It cannot be confirmed until that is collected. Ask on WhatsApp - the agent writes the answer straight onto this order.",
    };
  }

  const updated = await one<{ id: number }>(
    `update orders set status = 'confirmed' where id = $1 and status = 'draft' returning id`,
    [id],
  );
  if (!updated) return stale(`Order #${id} changed while you were looking at it.`);

  revalidatePath("/orders");
  return { ok: true, message: `Order #${id} confirmed.`, description: "It now counts towards today's courier total." };
}

/** Shipped is the end of the line - there is no un-ship. */
export async function markOrderShipped(orderId: number): Promise<Result> {
  const id = asId(orderId);
  if (!id) return { ok: false, message: "That is not an order." };

  const updated = await one<{ id: number }>(
    `update orders set status = 'shipped' where id = $1 and status = 'confirmed' returning id`,
    [id],
  );
  if (!updated) {
    const row = await one<{ status: string }>(`select status from orders where id = $1`, [id]);
    if (!row) return stale(`Order #${id} no longer exists.`);
    return stale(`Order #${id} is ${row.status}, not confirmed.`, "Only a confirmed order can be marked shipped.");
  }

  revalidatePath("/orders");
  return { ok: true, message: `Order #${id} marked shipped.` };
}

export async function cancelOrder(orderId: number): Promise<Result> {
  const id = asId(orderId);
  if (!id) return { ok: false, message: "That is not an order." };

  const updated = await one<{ id: number }>(
    `update orders set status = 'cancelled'
      where id = $1 and status in ('draft', 'confirmed') returning id`,
    [id],
  );
  if (!updated) {
    const row = await one<{ status: string }>(`select status from orders where id = $1`, [id]);
    if (!row) return stale(`Order #${id} no longer exists.`);
    return stale(
      `Order #${id} is already ${row.status}.`,
      row.status === "shipped" ? "A shipped order cannot be cancelled here." : undefined,
    );
  }

  revalidatePath("/orders");
  return { ok: true, message: `Order #${id} cancelled.`, description: "Tell the customer yourself - this sends nothing." };
}
