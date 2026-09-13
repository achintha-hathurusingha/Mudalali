import { query } from "../memory/db.js";

export type Product = {
  id: string;
  name: string;
  nameSi: string | null;
  priceLkr: number;
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
};

export async function loadCatalog(): Promise<Product[]> {
  const rows = await query<CatalogRow>(
    `select id, name, name_si, price_lkr, sizes, colours, stock, active
       from catalog where active = true order by id`,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nameSi: r.name_si,
    priceLkr: r.price_lkr,
    sizes: r.sizes,
    colours: r.colours,
    stock: r.stock,
    active: r.active,
  }));
}

export async function getProduct(id: string): Promise<Product | null> {
  const all = await loadCatalog();
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Rendered into the prompt verbatim. Keep it stable and deterministic -
 * byte changes here invalidate the prompt cache on every request.
 */
export function renderCatalog(products: Product[]): string {
  const lines = products.map((p) => {
    const stock = p.stock > 0 ? `in stock (${p.stock})` : "OUT OF STOCK";
    const si = p.nameSi ? ` / ${p.nameSi}` : "";
    return [
      `- ${p.id} | ${p.name}${si}`,
      `  price: Rs. ${p.priceLkr}`,
      `  sizes: ${p.sizes.join(", ") || "-"}`,
      `  colours: ${p.colours.join(", ") || "-"}`,
      `  ${stock}`,
    ].join("\n");
  });
  return lines.join("\n");
}
