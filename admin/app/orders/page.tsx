import { Nav } from "@/components/nav";
import { listOrders, readOrderSummary } from "@/lib/orders";
import { OrdersScreen } from "./order-list";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const orders = await listOrders();
  const summary = await readOrderSummary(orders.length);

  return (
    <main className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Nav current="/orders" />

      <OrdersScreen orders={orders} summary={summary} />
    </main>
  );
}
