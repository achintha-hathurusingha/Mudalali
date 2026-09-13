import { readFileSync } from "node:fs";
import path from "node:path";
import { query, one } from "@/lib/db";

/**
 * Server-only catalog access. The agent quotes prices and refuses orders from
 * exactly these rows, so every write here is visible in a customer's chat
 * within seconds.
 *
 * Client components must not import this file - it pulls in `pg` through
 * lib/db, and Turbopack reports that as a missing build manifest rather than
 * as what it is. The client declares its own copy of the product shape.
 */

export type Product = {
  id: string;
  name: string;
  name_si: string | null;
  price_lkr: number;
  sizes: string[];
  colours: string[];
  stock: number;
  active: boolean;
  /** ISO timestamp, for a precise tooltip. */
  updated_at: string;
  /** Human label, computed on the server so it cannot drift during hydration. */
  updated_label: string;
  /** Order lines pointing at this product. Non-zero means delete is impossible. */
  order_lines: number;
  /** Colours the agent has a photo for. Read-only here; upload is a separate task. */
  photo_colours: string[];
};

/** What a create or update writes. Already validated by the time it gets here. */
export type ProductInput = {
  id: string;
  name: string;
  name_si: string | null;
  price_lkr: number;
  sizes: string[];
  colours: string[];
  stock: number;
  active: boolean;
};

type CatalogRow = {
  id: string;
  name: string;
  name_si: string | null;
  price_lkr: number;
  sizes: string[];
  colours: string[];
  stock: number;
  active: boolean;
  updated_at: Date | string;
  order_lines: number;
};

type IdRow = { id: string };
type CountRow = { n: number };

/**
 * The agent answers "photo ewanna" from this file in the repo root, one entry
 * per product per colour. Shown here so the owner can see which products would
 * arrive without a picture; editing it is a separate task. Best effort: the
 * console can be deployed apart from the agent, in which case there is simply
 * no file and no badge.
 */
function photoIndex(): Record<string, Record<string, string>> {
  try {
    const file = path.join(process.cwd(), "..", "data", "product-photos.json");
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, Record<string, string>>;
  } catch {
    return {};
  }
}

function updatedLabel(value: Date | string): string {
  const when = value instanceof Date ? value : new Date(value);
  const ms = Date.now() - when.getTime();
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function toIso(value: Date | string): string {
  const when = value instanceof Date ? value : new Date(value);
  return Number.isNaN(when.getTime()) ? "" : when.toISOString();
}

export async function readProducts(): Promise<Product[]> {
  const rows = await query<CatalogRow>(
    `select c.id,
            c.name,
            c.name_si,
            c.price_lkr,
            c.sizes,
            c.colours,
            c.stock,
            c.active,
            c.updated_at,
            (select count(*) from order_items oi where oi.product_id = c.id)::int as order_lines
       from catalog c
      order by c.id`,
  );

  const photos = photoIndex();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    name_si: row.name_si,
    price_lkr: row.price_lkr,
    sizes: row.sizes ?? [],
    colours: row.colours ?? [],
    stock: row.stock,
    active: row.active,
    updated_at: toIso(row.updated_at),
    updated_label: updatedLabel(row.updated_at),
    order_lines: row.order_lines,
    photo_colours: Object.keys(photos[row.id] ?? {}),
  }));
}

export async function productExists(id: string): Promise<boolean> {
  const row = await one<IdRow>(`select id from catalog where id = $1`, [id]);
  return row !== null;
}

/** Order lines referencing a product. Anything above zero makes delete impossible. */
export async function countOrderLines(id: string): Promise<number> {
  const row = await one<CountRow>(
    `select count(*)::int as n from order_items where product_id = $1`,
    [id],
  );
  return row?.n ?? 0;
}

export async function insertProduct(input: ProductInput): Promise<void> {
  await query(
    `insert into catalog (id, name, name_si, price_lkr, sizes, colours, stock, active, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [
      input.id,
      input.name,
      input.name_si,
      input.price_lkr,
      input.sizes,
      input.colours,
      input.stock,
      input.active,
    ],
  );
}

/** Returns false when the id no longer exists - someone else deleted it. */
export async function updateProduct(input: ProductInput): Promise<boolean> {
  const row = await one<IdRow>(
    `update catalog
        set name = $2,
            name_si = $3,
            price_lkr = $4,
            sizes = $5,
            colours = $6,
            stock = $7,
            active = $8,
            updated_at = now()
      where id = $1
      returning id`,
    [
      input.id,
      input.name,
      input.name_si,
      input.price_lkr,
      input.sizes,
      input.colours,
      input.stock,
      input.active,
    ],
  );
  return row !== null;
}

export async function setActive(id: string, active: boolean): Promise<boolean> {
  const row = await one<IdRow>(
    `update catalog set active = $2, updated_at = now() where id = $1 returning id`,
    [id, active],
  );
  return row !== null;
}

/**
 * Deletes only when nothing has ever been ordered. The `not exists` guard makes
 * that atomic: without it an order placed between the check and the delete
 * would surface as a raw foreign-key error.
 */
export async function deleteProduct(id: string): Promise<boolean> {
  const row = await one<IdRow>(
    `delete from catalog
      where id = $1
        and not exists (select 1 from order_items oi where oi.product_id = catalog.id)
      returning id`,
    [id],
  );
  return row !== null;
}
