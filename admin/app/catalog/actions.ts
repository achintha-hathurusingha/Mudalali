"use server";

import { revalidatePath } from "next/cache";
import { isSignedIn } from "@/lib/auth";
import {
  countOrderLines,
  deleteProduct,
  insertProduct,
  productExists,
  setActive,
  updateProduct,
  type ProductInput,
} from "@/lib/catalog";

/**
 * Writes to the catalog the agent quotes from. Everything the owner typed
 * arrives here as raw strings and is validated on the server: a client-side
 * check is a courtesy, not a guarantee, and these are public endpoints.
 *
 * Failures come back as a value so the dialog can show them next to the field
 * the owner was editing, instead of throwing a page-level error over a typo.
 */

/** Exactly what the form holds, before any parsing. */
type Draft = {
  id: string;
  name: string;
  nameSi: string;
  price: string;
  stock: string;
  sizes: string;
  colours: string;
  active: boolean;
};

type Result = { ok: true } | { ok: false; error: string };

const MAX_ID_LENGTH = 40;
const MAX_NAME_LENGTH = 120;
const MAX_PRICE_LKR = 100_000_000;
const MAX_STOCK = 1_000_000;
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Forgiving on purpose: commas, newlines and stray spacing all separate, blanks
 * disappear, and a repeated entry is kept once. "S, M , m,, L" is S, M, L.
 */
function parseList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\n\r]+/)) {
    const value = part.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/** Accepts "1890", "1,890" and "Rs 1890" - rejects anything that is not whole. */
function parseWholeNumber(
  raw: string,
  label: string,
  min: number,
  max: number,
): { ok: true; value: number } | { ok: false; error: string } {
  const cleaned = raw.replace(/[\s,]/g, "").replace(/^(?:rs\.?|lkr)/i, "");
  if (cleaned === "") return { ok: false, error: `${label} is required.` };
  if (!/^\d+$/.test(cleaned)) {
    return {
      ok: false,
      error: `${label} must be a whole number${min > 0 ? " above zero" : " (0 or more)"} - "${raw.trim()}" is not.`,
    };
  }
  const value = Number(cleaned);
  if (value < min) {
    return {
      ok: false,
      error: min > 0 ? `${label} must be above zero.` : `${label} cannot be negative.`,
    };
  }
  if (value > max) return { ok: false, error: `${label} looks wrong - ${value} is too large.` };
  return { ok: true, value };
}

function cleanDraft(draft: Draft): { ok: true; value: ProductInput } | { ok: false; error: string } {
  const id = draft.id.trim();
  if (!id) return { ok: false, error: "Product code is required - the agent quotes it in chats." };
  if (id.length > MAX_ID_LENGTH) {
    return { ok: false, error: `Product code must be ${MAX_ID_LENGTH} characters or fewer.` };
  }
  if (!ID_SHAPE.test(id)) {
    return {
      ok: false,
      error: "Product code can use letters, numbers, dots, dashes and underscores only - no spaces.",
    };
  }

  const name = draft.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }

  const nameSi = draft.nameSi.trim();
  if (nameSi.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `Sinhala name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }

  const price = parseWholeNumber(draft.price, "Price", 1, MAX_PRICE_LKR);
  if (!price.ok) return price;

  const stock = parseWholeNumber(draft.stock, "Stock", 0, MAX_STOCK);
  if (!stock.ok) return stock;

  return {
    ok: true,
    value: {
      id,
      name,
      name_si: nameSi === "" ? null : nameSi,
      price_lkr: price.value,
      sizes: parseList(draft.sizes),
      colours: parseList(draft.colours),
      stock: stock.value,
      active: draft.active,
    },
  };
}

/**
 * proxy.ts already blocks unauthenticated requests to every route, including
 * the POSTs these actions travel on. Checked again here because a catalog write
 * reaches customers, and depending on one layer for that is thin.
 */
async function denyIfSignedOut(): Promise<Result | null> {
  if (await isSignedIn()) return null;
  return { ok: false, error: "Your session has expired. Reload the page and sign in again." };
}

function describeDbError(error: unknown, fallback: string): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
  if (code === "23505") return "That product code is already taken.";
  if (code === "23503") {
    return "This product is referenced by an order, so it cannot be deleted. Deactivate it instead.";
  }
  console.error("[catalog]", error);
  return fallback;
}

export async function addProduct(draft: Draft): Promise<Result> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const cleaned = cleanDraft(draft);
  if (!cleaned.ok) return cleaned;

  if (await productExists(cleaned.value.id)) {
    return { ok: false, error: `${cleaned.value.id} already exists. Edit that product instead.` };
  }

  try {
    await insertProduct(cleaned.value);
  } catch (error) {
    return { ok: false, error: describeDbError(error, "Could not add that product. Nothing changed.") };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

/** The product code is the key and is never rewritten - orders point at it. */
export async function editProduct(draft: Draft): Promise<Result> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  const cleaned = cleanDraft(draft);
  if (!cleaned.ok) return cleaned;

  try {
    const updated = await updateProduct(cleaned.value);
    if (!updated) {
      return { ok: false, error: `${cleaned.value.id} no longer exists. Reload the page.` };
    }
  } catch (error) {
    return { ok: false, error: describeDbError(error, "Could not save that product. Nothing changed.") };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

/** Deactivating is the safe alternative to deleting: the agent stops offering it. */
export async function toggleActive(id: string, active: boolean): Promise<Result> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  try {
    const changed = await setActive(id, active);
    if (!changed) return { ok: false, error: `${id} no longer exists. Reload the page.` };
  } catch (error) {
    return { ok: false, error: describeDbError(error, "Could not change that. Nothing changed.") };
  }

  revalidatePath("/catalog");
  return { ok: true };
}

/**
 * Only ever succeeds for a product nobody has ordered. order_items references
 * catalog(id) with no cascade, so anything else is a foreign-key error dressed
 * up as a crash - and losing the row would orphan a real order.
 */
export async function removeProduct(id: string): Promise<Result> {
  const denied = await denyIfSignedOut();
  if (denied) return denied;

  try {
    const removed = await deleteProduct(id);
    if (!removed) {
      const lines = await countOrderLines(id);
      if (lines > 0) {
        return {
          ok: false,
          error: `${id} appears on ${lines} order line${lines === 1 ? "" : "s"}, so deleting it would break those orders. Deactivate it instead.`,
        };
      }
      return { ok: false, error: `${id} no longer exists. Reload the page.` };
    }
  } catch (error) {
    return { ok: false, error: describeDbError(error, "Could not delete that product. Nothing changed.") };
  }

  revalidatePath("/catalog");
  return { ok: true };
}
