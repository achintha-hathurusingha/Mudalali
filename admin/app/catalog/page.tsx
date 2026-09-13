import { Nav } from "@/components/nav";
import { readProducts } from "@/lib/catalog";
import { CatalogTable } from "./products";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const products = await readProducts();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Nav current="/catalog" />

      <div className="mb-6">
        <h1 className="font-display text-2xl leading-tight tracking-tight">Catalog &amp; inventory</h1>
        <p className="text-muted-foreground text-sm">
          The rows the agent quotes prices and stock from. A wrong number here reaches a customer in
          the next message.
        </p>
      </div>

      <CatalogTable products={products} />
    </main>
  );
}
