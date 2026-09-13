import { Nav } from "@/components/nav";
import { listOrders, readOrderSummary } from "@/lib/orders";
import { OrdersScreen } from "./order-list";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await listOrders();
  const summary = await readOrderSummary(orders.length);

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <Nav current="/orders" />

      <div className="mb-8">
        <h1 className="font-display text-2xl leading-tight tracking-tight">Orders</h1>
        <p className="text-muted-foreground text-sm">
          Everything a customer has committed to on WhatsApp. Confirm the draft, then mark it shipped once the
          courier has it.
        </p>
      </div>

      <OrdersScreen orders={orders} summary={summary} />
    </main>
  );
}
