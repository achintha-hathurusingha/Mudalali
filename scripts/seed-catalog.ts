import { readFileSync } from "node:fs";
import { query, closeDb } from "../src/memory/db.js";

type SeedProduct = {
  id: string;
  name: string;
  nameSi: string | null;
  priceLkr: number;
  sizes: string[];
  colours: string[];
  stock: number;
  active: boolean;
};

const products: SeedProduct[] = JSON.parse(readFileSync("./data/catalog.json", "utf8"));

for (const p of products) {
  await query(
    `insert into catalog (id, name, name_si, price_lkr, sizes, colours, stock, active, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now())
     on conflict (id) do update set
       name = excluded.name, name_si = excluded.name_si, price_lkr = excluded.price_lkr,
       sizes = excluded.sizes, colours = excluded.colours, stock = excluded.stock,
       active = excluded.active, updated_at = now()`,
    [p.id, p.name, p.nameSi, p.priceLkr, p.sizes, p.colours, p.stock, p.active],
  );
}

console.log(`Seeded ${products.length} products.`);
await closeDb();
