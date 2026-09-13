"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MessageCircleIcon, TruckIcon } from "lucide-react";
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

/** Status is colour: saffron waits, teal is settled, sky is moving, muted is over. */
type StatusMeta = { label: string; chip: string; accent: string; note: string };

const STATUS_META: Record<string, StatusMeta> = {
  draft: {
    label: "Draft",
    chip: "chip-saffron",
    accent: "var(--saffron)",
    note: "waiting for you",
  },
  confirmed: {
    label: "Confirmed",
    chip: "chip-teal",
    accent: "var(--teal)",
    note: "for the courier",
  },
  shipped: { label: "Shipped", chip: "chip-sky", accent: "var(--sky)", note: "gone out" },
  cancelled: {
    label: "Cancelled",
    chip: "chip-muted",
    accent: "var(--line-strong)",
    note: "closed",
  },
};

function meta(status: string): StatusMeta {
  return (
    STATUS_META[status] ?? {
      label: status,
      chip: "chip-muted",
      accent: "var(--line-strong)",
      note: "unknown status",
    }
  );
}

/** The shop writes money one way: Rs. 1890. No separators, no decimals. */
function lkr(amount: number): string {
  return `Rs. ${Math.round(amount)}`;
}

/** "address" / "address and city" / "phone, address and city" */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/* ------------------------------------------------------------- the colours */

/**
 * A line says "Navy", so it should look navy - the same dots the Stock screen
 * draws, so a colour reads the same in both places.
 */
const COLOUR_HEX: Record<string, string> = {
  black: "#17171c",
  white: "#f4f4ef",
  offwhite: "#ece8de",
  ivory: "#f5efdf",
  cream: "#f0e4c8",
  beige: "#e2cfab",
  tan: "#d2a679",
  khaki: "#b8a369",
  brown: "#8b5a2b",
  chocolate: "#5a3825",
  grey: "#9aa1ad",
  gray: "#9aa1ad",
  charcoal: "#3a3f4a",
  silver: "#c6ccd4",
  navy: "#1c2f63",
  blue: "#2f6fe4",
  denim: "#3f6187",
  indigo: "#4b45cc",
  sky: "#47b6ff",
  turquoise: "#1fb6c9",
  teal: "#159c8c",
  mint: "#7fd8a8",
  green: "#2e9e4f",
  olive: "#6f7a35",
  lime: "#a7cf3a",
  yellow: "#e8c02a",
  mustard: "#cf9f21",
  gold: "#d4af37",
  orange: "#ef7d2b",
  peach: "#f4b393",
  coral: "#f4705c",
  red: "#d8332f",
  rust: "#b0491f",
  maroon: "#7a2130",
  burgundy: "#5f1c2c",
  wine: "#63213a",
  pink: "#e96aa0",
  rose: "#e0637d",
  magenta: "#cf3fbf",
  purple: "#7c46cf",
  violet: "#8b5cf6",
  lavender: "#b9a9ef",
  multicolour: "#8b5cf6",
  multicolor: "#8b5cf6",
  printed: "#8b5cf6",
};

const SHADE_WORDS = ["light", "dark", "deep", "pale", "bright", "hot", "off", "dull"];

function colourSwatch(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return "hsl(220 10% 55%)";
  if (COLOUR_HEX[key]) return COLOUR_HEX[key];

  for (const word of SHADE_WORDS) {
    if (key.startsWith(word)) {
      const base = COLOUR_HEX[key.slice(word.length)];
      if (base) return base;
    }
  }
  for (const base of Object.keys(COLOUR_HEX)) {
    if (key.length > base.length && key.endsWith(base)) return COLOUR_HEX[base];
  }

  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  return `hsl(${hash} 52% 58%)`;
}

function ColourDot({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-full border border-white/35 shadow-[0_1px_3px_rgb(0_0_0/0.55)]"
      style={{ background: colourSwatch(name) }}
    />
  );
}

/* -------------------------------------------------------------- the motion */

/** Counts from the old value to the new one, so a changed total is seen moving. */
function useCountUp(value: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;

    // A reduced-motion reader gets the same code path with no duration: one
    // frame, straight to the new value. setState stays inside the callback.
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduced ? 0 : 700;

    let frame = 0;
    const started = performance.now();
    const step = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(from + (value - from) * eased);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return shown;
}

/* --------------------------------------------------------------- the screen */

export function OrdersScreen({ orders, summary }: { orders: Order[]; summary: OrderSummary }) {
  const [tab, setTab] = useState<string>("all");

  const filtered = useMemo(
    () => (tab === "all" ? orders : orders.filter((order) => order.status === tab)),
    [orders, tab],
  );

  if (summary.total === 0) return <NothingYet />;

  const tabs = [
    { id: "all", label: "All", count: summary.total, chip: "chip-muted" },
    ...STATUSES.map((status) => ({
      id: status as string,
      label: meta(status).label,
      count: summary.counts[status] ?? 0,
      chip: meta(status).chip,
    })),
  ];

  return (
    <div>
      <Hero summary={summary} />

      <div
        className="rise glass mt-5 flex flex-wrap items-center gap-1.5 rounded-2xl p-2.5"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        {tabs.map((option) => {
          const on = tab === option.id;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(option.id)}
              className={cn(
                "chip cursor-pointer transition-all hover:brightness-125",
                on
                  ? "bg-surface-3 border-line-strong text-foreground shadow-[0_6px_18px_-10px_rgb(0_0_0/0.9)]"
                  : option.chip,
              )}
            >
              {option.label}
              <span className="tnum opacity-70">{option.count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-4">
        {filtered.length === 0 ? (
          <p
            className="rise glass text-dim rounded-2xl px-6 py-10 text-center text-sm"
            style={{ "--i": 3 } as React.CSSProperties}
          >
            {tab === "all"
              ? "Nothing here."
              : `No ${meta(tab).label.toLowerCase()} orders right now.`}
          </p>
        ) : (
          filtered.map((order, index) => (
            <OrderCard key={order.id} order={order} index={Math.min(index, 8) + 3} />
          ))
        )}
      </div>

      {summary.truncated ? (
        <p className="text-faint mt-6 text-xs">
          Showing the newest {summary.listed} of {summary.total} orders. The figures above cover all
          of them.
        </p>
      ) : null}
    </div>
  );
}

/**
 * One number matters in the morning: what has been confirmed and is still
 * sitting in the shop. Everything else on this band is context for it.
 */
function Hero({ summary }: { summary: OrderSummary }) {
  const money = useCountUp(summary.awaitingCourierLkr);
  const drafts = summary.counts.draft ?? 0;
  const confirmed = summary.counts.confirmed ?? 0;

  return (
    <section
      className="rise glass relative overflow-hidden rounded-3xl p-6 sm:p-8"
      style={{ "--i": 1 } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-25 blur-3xl"
        style={{ background: "var(--grad-money)" }}
      />

      <div className="relative">
        <span className={cn("chip", drafts > 0 ? "chip-saffron" : "chip-teal")}>
          <span className={cn("size-1.5 rounded-full bg-current", drafts > 0 && "breathe")} />
          {drafts > 0
            ? `${drafts} draft${drafts === 1 ? "" : "s"} waiting for you`
            : "Nothing waiting for you"}
        </span>

        <h1 className="font-display text-grad-money tnum mt-4 text-[2.5rem] leading-none font-semibold tracking-tight sm:text-6xl">
          {lkr(money)}
        </h1>
        <p className="text-dim mt-3 max-w-[48ch] text-sm">
          Confirmed and not yet shipped — {confirmed} order{confirmed === 1 ? "" : "s"} sitting in
          the shop, waiting for the courier.
        </p>

        <div className="border-line mt-7 border-t pt-5">
          <Pipeline counts={summary.counts} />
        </div>
      </div>
    </section>
  );
}

/** Draft → Confirmed → Shipped, in colour, with cancelled kept to one side. */
function Pipeline({ counts }: { counts: Record<string, number> }) {
  const flow = ["draft", "confirmed", "shipped"] as const;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-4">
      {flow.map((status, index) => (
        <div key={status} className="flex items-center gap-4">
          <Stage status={status} count={counts[status] ?? 0} />
          {index < flow.length - 1 ? (
            <span
              aria-hidden
              className="h-px w-6 shrink-0 sm:w-10"
              style={{
                background: `linear-gradient(90deg, ${meta(status).accent}, ${meta(flow[index + 1]).accent})`,
                opacity: 0.5,
              }}
            />
          ) : null}
        </div>
      ))}
      <span aria-hidden className="bg-line mx-1 hidden h-8 w-px sm:block" />
      <Stage status="cancelled" count={counts.cancelled ?? 0} />
    </div>
  );
}

function Stage({ status, count }: { status: string; count: number }) {
  const shown = useCountUp(count);
  const info = meta(status);
  const live = count > 0 && status !== "cancelled";

  return (
    <div className="min-w-[5.5rem]">
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{
            background: info.accent,
            boxShadow: live ? `0 0 12px -1px ${info.accent}` : "none",
            opacity: live ? 1 : 0.45,
          }}
          aria-hidden
        />
        <span
          className="font-display tnum text-2xl leading-none font-semibold"
          style={{ color: count > 0 ? info.accent : "var(--text-faint)" }}
        >
          {shown}
        </span>
      </div>
      <p className="text-faint mt-1.5 text-[11px]">
        {info.label} <span className="opacity-60">· {info.note}</span>
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- the card */

function OrderCard({ order, index }: { order: Order; index: number }) {
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

  const info = meta(order.status);
  const open = order.status === "draft" || order.status === "confirmed";
  // A shipped or cancelled order is history: incomplete details are a footnote
  // there, not an alarm. An open one cannot move until they are filled in.
  const alarming = order.missing.length > 0 && open;
  const shipTo = [order.address, order.city].filter(Boolean).join(", ");
  const addressGaps = order.missing.filter((field) => field === "address" || field === "city");

  return (
    <article
      className={cn(
        "rise glass glass-hover relative overflow-hidden rounded-2xl transition-opacity",
        alarming && "glow-rose",
        order.status === "cancelled" && "opacity-65",
        pending && "opacity-50",
      )}
      style={{ "--i": index } as React.CSSProperties}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: alarming ? "var(--rose)" : info.accent, opacity: 0.9 }}
      />

      <div className="border-line flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3.5">
        <span className="font-display tnum text-sm font-semibold">#{order.id}</span>
        <span className={cn("chip", info.chip)}>
          {order.status === "draft" ? (
            <span className="breathe size-1.5 rounded-full bg-current" />
          ) : null}
          {info.label}
        </span>
        <time dateTime={order.createdAt} className="text-faint text-xs">
          {order.createdLabel}
        </time>
        <span className="font-display tnum text-saffron ml-auto text-lg leading-none font-semibold">
          {lkr(order.totalLkr)}
        </span>
      </div>

      {alarming ? (
        <div className="border-line border-b bg-[rgb(251_74_107/0.08)] px-5 py-3 text-sm">
          <p className="text-rose font-medium">Cannot ship — no {listWords(order.missing)}.</p>
          <p className="text-dim mt-0.5 text-[13px] leading-snug">
            Ask on WhatsApp. The agent writes the answer straight onto this order, and Confirm stays
            blocked until it does.
          </p>
        </div>
      ) : null}

      <div className="px-5 py-3">
        {order.lines.length === 0 ? (
          <p className="text-faint py-2 text-sm">No items on this order.</p>
        ) : (
          <ul className="divide-line divide-y">
            {order.lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
                <span className="tnum text-faint w-7 shrink-0 text-xs">{line.quantity} ×</span>
                <span className="min-w-0 flex-1 text-sm">
                  {line.productName}
                  {line.size || line.colour ? (
                    <span className="text-dim ml-2 inline-flex items-center gap-1.5 text-xs">
                      {line.size ? (
                        <span className="bg-surface-2 border-line rounded-md border px-1.5 py-px">
                          {line.size}
                        </span>
                      ) : null}
                      {line.colour ? (
                        <span className="bg-surface-2 border-line inline-flex items-center gap-1 rounded-md border py-px pr-1.5 pl-1">
                          <ColourDot name={line.colour} />
                          {line.colour}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <span className="tnum text-faint text-xs">{lkr(line.unitPriceLkr)}</span>
                <span className="tnum w-24 text-right text-sm">{lkr(line.lineTotalLkr)}</span>
              </li>
            ))}
          </ul>
        )}

        <dl className="border-line mt-1 space-y-1 border-t pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-faint">Items</dt>
            <dd className="tnum text-dim">{lkr(order.itemsTotalLkr)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-faint">Delivery</dt>
            <dd className="tnum text-dim">{lkr(order.deliveryFeeLkr)}</dd>
          </div>
          <div className="flex justify-between pt-1">
            <dt className="font-medium">Total</dt>
            <dd className="tnum text-saffron font-semibold">{lkr(order.totalLkr)}</dd>
          </div>
        </dl>
      </div>

      <div className="border-line flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-t px-5 py-3.5">
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
              <CancelAction
                order={order}
                pending={pending}
                onConfirm={() => run(() => cancelOrder(order.id))}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => confirmOrder(order.id))}
                className="bg-teal glow-teal cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-[#04201c] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                Confirm
              </button>
            </>
          ) : null}

          {order.status === "confirmed" ? (
            <>
              <CancelAction
                order={order}
                pending={pending}
                onConfirm={() => run(() => cancelOrder(order.id))}
              />
              <Guarded
                trigger={
                  <button
                    type="button"
                    disabled={pending}
                    className="bg-sky cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold text-[#04141f] shadow-[0_10px_30px_-12px_var(--sky)] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
                  >
                    <TruckIcon className="mr-1.5 -ml-0.5 inline size-4 align-[-3px]" />
                    Mark shipped
                  </button>
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
            <span className="text-sky inline-flex items-center gap-1.5 text-sm">
              <TruckIcon className="size-4" />
              With the courier.
            </span>
          ) : null}
          {order.status === "cancelled" ? (
            <span className="text-faint text-sm">Cancelled.</span>
          ) : null}
        </div>
      </div>
    </article>
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
        <button
          type="button"
          disabled={pending}
          className="text-dim hover:text-rose hover:bg-surface-2 cursor-pointer rounded-xl px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
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
          <AlertDialogTitle className="font-display font-semibold tracking-tight">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-dim">{body}</AlertDialogDescription>
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
      <dt className="text-faint">{label}</dt>
      <dd className={cn(missing ? "text-rose" : "text-foreground")}>
        {value && !missing ? value : (missingText ?? `no ${label.toLowerCase()}`)}
      </dd>
    </>
  );
}

/* ---------------------------------------------------------------- day one */

/**
 * The only state of this screen that has to teach rather than report - and,
 * until the first customer commits, the whole screen.
 */
function NothingYet() {
  const steps = [
    {
      accent: "var(--violet)",
      label: "On WhatsApp",
      body: "A customer says yes — “ekak ewanna”, or a photo and a size. The agent understands it and writes the order down.",
    },
    {
      accent: "var(--saffron)",
      label: "Draft",
      body: "Items, sizes and colours, plus whatever name, phone and address it has collected. It never confirms one itself.",
    },
    {
      accent: "var(--teal)",
      label: "Confirmed",
      body: "You check the draft reads right and confirm it. From then on it counts towards the courier total above.",
    },
    {
      accent: "var(--sky)",
      label: "Shipped",
      body: "Marked once the courier has it. That is the last step — there is no way back from it here.",
    },
  ];

  return (
    <div>
      <section
        className="rise glass relative overflow-hidden rounded-3xl p-6 sm:p-9"
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 -right-20 size-80 rounded-full opacity-25 blur-3xl"
          style={{ background: "var(--grad-agent)" }}
        />

        <div className="relative">
          <span className="chip chip-violet">
            <span className="breathe size-1.5 rounded-full bg-current" />
            Listening on WhatsApp
          </span>

          <h1 className="font-display text-grad-agent mt-4 max-w-[16ch] text-[1.75rem] leading-[1.12] font-semibold tracking-tight sm:text-4xl">
            No orders yet.
          </h1>

          <p className="text-dim mt-3 max-w-[54ch] text-sm leading-relaxed">
            One appears here the moment a customer commits to buying — the agent writes it down as a
            draft and nothing else happens until you say so. Nobody has committed yet today.
          </p>

          <p className="text-faint mt-5 inline-flex items-center gap-2 text-xs">
            <MessageCircleIcon className="text-violet size-3.5" />
            Orders arrive by themselves. There is nothing to set up here.
          </p>
        </div>
      </section>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <div
            key={step.label}
            className="rise glass glass-hover relative overflow-hidden rounded-2xl p-5"
            style={{ "--i": index + 2 } as React.CSSProperties}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-0.5 opacity-80"
              style={{ background: step.accent }}
            />
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ background: step.accent, boxShadow: `0 0 12px -1px ${step.accent}` }}
              />
              <span
                className="font-display text-sm font-semibold tracking-tight"
                style={{ color: step.accent }}
              >
                {step.label}
              </span>
              <span className="text-faint tnum ml-auto text-xs">{index + 1}/4</span>
            </div>
            <p className="text-dim mt-2.5 text-[13px] leading-relaxed">{step.body}</p>
          </div>
        ))}
      </div>

      <p
        className="rise text-faint mt-6 max-w-[72ch] text-xs leading-relaxed"
        style={{ "--i": 6 } as React.CSSProperties}
      >
        An order still missing a name, phone, address or city is flagged in rose here and cannot be
        confirmed — that is what usually holds one up, and the fix is a WhatsApp message, not a form
        on this page.
      </p>
    </div>
  );
}
