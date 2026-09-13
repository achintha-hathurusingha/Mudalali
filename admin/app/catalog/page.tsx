import { Nav } from "@/components/nav";
import { readProducts } from "@/lib/catalog";
import { StockScreen } from "./products";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const products = await readProducts();

  return (
    <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <Nav current="/catalog" />

      <StockScreen products={products} />
    </main>
  );
}
