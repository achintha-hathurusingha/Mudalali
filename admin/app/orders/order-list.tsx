"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelOrder, confirmOrder, markOrderShipped } from "./actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * These shapes are the ones lib/orders.ts builds, written out again here on
 * purpose: this is a client component, and importing lib/orders would drag
 * `pg` into the browser bundle. The page passes the server rows straight into
 * <OrdersScreen>, so TypeScript checks the two definitions against each other
 * there - if they drift apart, the page stops compiling.
 */

type OrderLine = {
  id: number;
  productId: string | null;
  productName: string;
  size: string | null;
  colour: string | null;
  quantity: number;
  unitPriceLkr: number;
  lineTotalLkr: number;
};

type Order = {
  id: number;
  status: string;
  createdAt: string;
  createdLabel: string;
  customerName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  itemsTotalLkr: number;
  deliveryFeeLkr: number;
  totalLkr: number;
  lines: OrderLine[];
  missing: string[];
};

type OrderSummary = {
  counts: Record<string, number>;
  total: number;
  awaitingCourierLkr: number;
  truncated: boolean;
  listed: number;
};

type ActionResult = { ok: boolean; message: string; description?: string };

const STATUSES = ["draft", "confirmed", "shipped", "cancelled"] as const;

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  confirmed: "Confirmed",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

const STATUS_BADGE: Record<string, string> = {
  draft: "border-border bg-background text-foreground",
  confirmed: "bg-foreground text-background",
  shipped: "bg-muted text-muted-foreground",
  cancelled: "border-border text-muted-foreground line-through",
};

/** The shop writes money one way: Rs. 1890. No separators, no decimals. */
function lkr(amount: number): string {
  return `Rs. ${Math.round(amount)}`;
}

/** "address" / "address and city" / "phone, address and city" */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export function OrdersScreen({ orders, summary }: { orders: Order[]; summary: OrderSummary }) {
  const [tab, setTab] = useState("all");

  const filtered = useMemo(
    () => (tab === "all" ? orders : orders.filter((order) => order.status === tab)),
    [orders, tab],
  );

  if (summary.total === 0) return <NothingYet />;

  return (
    <div className="space-y-6">
      <SummaryBar summary={summary} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">
            All <span className="text-muted-foreground tabular-nums">{summary.total}</span>
          </TabsTrigger>
          {STATUSES.map((status) => (
            <TabsTrigger key={status} value={status}>
              {STATUS_LABEL[status]}{" "}
              <span className="text-muted-foreground tabular-nums">{summary.counts[status] ?? 0}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={tab} className="mt-2 space-y-3">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground rounded-lg border border-dashed p-6 text-sm">
              {tab === "all"
                ? "Nothing here."
                : `No ${STATUS_LABEL[tab]?.toLowerCase() ?? tab} orders right now.`}
            </p>
          ) : (
            filtered.map((order) => <OrderCard key={order.id} order={order} />)
          )}
        </TabsContent>
      </Tabs>

      {summary.truncated ? (
        <p className="text-muted-foreground text-xs">
          Showing the newest {summary.listed} of {summary.total} orders. The counts above cover all of them.
        </p>
      ) : null}
    </div>
  );
}

/** Counts, and the one number the owner reaches for in the morning. */
function SummaryBar({ summary }: { summary: OrderSummary }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 rounded-lg border p-4">
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {STATUSES.map((status) => (
          <div key={status}>
            <p className="font-display text-3xl leading-none tabular-nums">{summary.counts[status] ?? 0}</p>
            <p className="text-muted-foreground mt-1.5 text-xs">{STATUS_LABEL[status]}</p>
          </div>
        ))}
      </div>
      <div className="sm:text-right">
        <p className="font-display text-3xl leading-none tabular-nums">{lkr(summary.awaitingCourierLkr)}</p>
        <p className="text-muted-foreground mt-1.5 text-xs">Confirmed, not yet shipped</p>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const [pending, start] = useTransition();

  const run = (action: () => Promise<ActionResult>) =>
    start(async () => {
      try {
        const result = await action();
        if (result.ok) toast.success(result.message, { description: result.description });
        else toast.error(result.message, { description: result.description });
      } catch {
        toast.error("Could not reach the server.", { description: "Nothing changed - try again." });
      }
    });

  const open = order.status === "draft" || order.status === "confirmed";
  // A shipped or cancelled order is history: incomplete details are a footnote
  // there, not an alarm. An open one cannot move until they are filled in.
  const alarming = order.missing.length > 0 && open;
  const shipTo = [order.address, order.city].filter(Boolean).join(", ");
  const addressGaps = order.missing.filter((field) => field === "address" || field === "city");

  return (
    <div
      className={cn(
        "rounded-lg border",
        alarming && "border-destructive/50 bg-destructive/5",
        order.status === "cancelled" && "opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        <span className="font-medium tabular-nums">#{order.id}</span>
        <Badge className={cn(STATUS_BADGE[order.status] ?? "border-border text-muted-foreground")}>
          {STATUS_LABEL[order.status] ?? order.status}
        </Badge>
        <time dateTime={order.createdAt} className="text-muted-foreground text-sm">
          {order.createdLabel}
        </time>
        <span className="text-muted-foreground ml-auto text-sm tabular-nums">{lkr(order.totalLkr)}</span>
      </div>

      {alarming ? (
        <div className="text-destructive border-b px-4 py-2.5 text-sm">
          <span className="font-medium">Cannot ship - no {listWords(order.missing)}.</span>{" "}
          <span className="opacity-80">
            Ask on WhatsApp. The agent writes the answer onto this order, and confirm stays blocked until it does.
          </span>
        </div>
      ) : null}

      <div className="px-4 py-1">
        {order.lines.length === 0 ? (
          <p className="text-muted-foreground py-3 text-sm">No items on this order.</p>
        ) : (
          <Table>
            <TableBody>
              {order.lines.map((line) => (
                <TableRow key={line.id} className="hover:bg-transparent">
                  <TableCell className="w-10 pl-0 tabular-nums">{line.quantity} &times;</TableCell>
                  <TableCell className="w-full whitespace-normal">{line.productName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {[line.size, line.colour].filter(Boolean).join(" / ") || "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {lkr(line.unitPriceLkr)}
                  </TableCell>
                  <TableCell className="pr-0 text-right tabular-nums">{lkr(line.lineTotalLkr)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter className="bg-transparent font-normal">
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-muted-foreground pl-0">
                  Items
                </TableCell>
                <TableCell className="text-muted-foreground pr-0 text-right tabular-nums">
                  {lkr(order.itemsTotalLkr)}
                </TableCell>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="text-muted-foreground pl-0">
                  Delivery
                </TableCell>
                <TableCell className="text-muted-foreground pr-0 text-right tabular-nums">
                  {lkr(order.deliveryFeeLkr)}
                </TableCell>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="pl-0 font-medium">
                  Total
                </TableCell>
                <TableCell className="pr-0 text-right font-medium tabular-nums">{lkr(order.totalLkr)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t px-4 py-3">
        <dl className="grid min-w-56 grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1 text-sm">
          <Detail label="Name" value={order.customerName} missing={order.missing.includes("name")} />
          <Detail label="Phone" value={order.phone} missing={order.missing.includes("phone")} />
          <Detail
            label="Ship to"
            value={shipTo || null}
            missing={addressGaps.length > 0}
            missingText={addressGaps.length > 0 ? `no ${listWords(addressGaps)}` : undefined}
          />
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          {order.status === "draft" ? (
            <>
              <CancelAction order={order} pending={pending} onConfirm={() => run(() => cancelOrder(order.id))} />
              <Button size="sm" disabled={pending} onClick={() => run(() => confirmOrder(order.id))}>
                Confirm
              </Button>
            </>
          ) : null}

          {order.status === "confirmed" ? (
            <>
              <CancelAction order={order} pending={pending} onConfirm={() => run(() => cancelOrder(order.id))} />
              <Guarded
                trigger={
                  <Button size="sm" disabled={pending}>
                    Mark shipped
                  </Button>
                }
                title={`Mark order #${order.id} shipped?`}
                body={`${lkr(order.totalLkr)} to ${order.customerName ?? "this customer"}, ${
                  shipTo || "no address on file"
                }. Shipped is the last step - there is no way back from it here.`}
                confirmLabel="Mark shipped"
                onConfirm={() => run(() => markOrderShipped(order.id))}
              />
            </>
          ) : null}

          {order.status === "shipped" ? (
            <span className="text-muted-foreground text-sm">With the courier.</span>
          ) : null}
          {order.status === "cancelled" ? (
            <span className="text-muted-foreground text-sm">Cancelled.</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CancelAction({
  order,
  pending,
  onConfirm,
}: {
  order: Order;
  pending: boolean;
  onConfirm: () => void;
}) {
  const items = order.lines.length === 1 ? "1 item" : `${order.lines.length} items`;
  return (
    <Guarded
      trigger={
        <Button size="sm" variant="ghost" disabled={pending}>
          Cancel
        </Button>
      }
      title={`Cancel order #${order.id}?`}
      body={`${items}, ${lkr(order.totalLkr)}, for ${
        order.customerName ?? "an unnamed customer"
      }. The customer is not told - message them yourself.`}
      confirmLabel="Cancel order"
      destructive
      onConfirm={onConfirm}
    />
  );
}

/** Anything that cannot be undone from this screen asks first. */
function Guarded({
  trigger,
  title,
  body,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  body: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep as is</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Detail({
  label,
  value,
  missing,
  missingText,
}: {
  label: string;
  value: string | null;
  missing: boolean;
  missingText?: string;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn(missing && "text-destructive")}>
        {value && !missing ? value : (missingText ?? `no ${label.toLowerCase()}`)}
      </dd>
    </>
  );
}

/**
 * Day one, and the only state of this screen that has to teach rather than
 * report.
 */
function NothingYet() {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10">
      <p className="font-display text-xl leading-none tracking-tight">No orders yet.</p>
      <p className="text-muted-foreground mt-2 max-w-prose text-sm">
        An order appears here the moment a customer commits to buying on WhatsApp. The agent writes it down as a
        draft - the items, sizes and colours it understood, plus whatever name, phone and address it has collected
        so far - and never confirms one itself.
      </p>
      <p className="text-muted-foreground mt-2 max-w-prose text-sm">
        Your part is the rest: check the draft reads right, confirm it, then mark it shipped once the courier has
        it. Orders still missing an address are flagged here, because that is what usually holds one up.
      </p>
    </div>
  );
}
