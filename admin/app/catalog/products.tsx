"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { MoreHorizontalIcon, PlusIcon, SearchIcon } from "lucide-react";
import { toast } from "sonner";
import { addProduct, editProduct, removeProduct, toggleActive } from "./actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * The shape the page hands down. Declared here rather than imported from
 * lib/catalog on purpose: that module reaches Postgres through `pg`, and a
 * client component that imports it - even for a type - invites someone to
 * import a function from it later and break the browser bundle.
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
  updated_at: string;
  updated_label: string;
  order_lines: number;
  photo_colours: string[];
};

type ActionResult = { ok: true } | { ok: false; error: string };

/** Below this the shop can still sell, but a run of orders would empty it. */
const LOW_STOCK = 5;

type Filter = "all" | "attention" | "hidden";

/** The shop writes money one way: Rs. 1890. No separators, no decimals. */
function lkr(amount: number): string {
  return `Rs. ${Math.round(amount)}`;
}

/** Mirrors the parsing in actions.ts, so the hint shows what will be saved. */
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

/* ------------------------------------------------------------- the colours */

/**
 * It is a clothing shop: "Navy" should look navy. Names the shop actually
 * writes, plus enough of the usual English wardrobe to cover a new line going
 * in at the counter. Anything unrecognised still gets a dot - a stable hue
 * derived from the word - rather than nothing, so the row never looks broken.
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

/** The dot is the decoration; the word beside it is what a screen reader gets. */
function ColourDot({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-3 shrink-0 rounded-full border border-white/35 shadow-[0_1px_3px_rgb(0_0_0/0.55)]",
        className,
      )}
      style={{ background: colourSwatch(name) }}
    />
  );
}

/* --------------------------------------------------------------- the stock */

type Tone = {
  chip: string;
  label: string;
  accent: string;
};

function stockTone(stock: number): Tone {
  if (stock === 0) {
    return { chip: "chip-rose", label: "Out of stock", accent: "var(--rose)" };
  }
  if (stock < LOW_STOCK) {
    return { chip: "chip-saffron", label: `Low · ${stock} left`, accent: "var(--saffron)" };
  }
  return { chip: "chip-teal", label: `${stock} in stock`, accent: "var(--teal)" };
}

/**
 * Out of stock first - it is the only row that is costing the shop money right
 * now - then low, then the healthy ones, then anything hidden from the agent.
 */
function rank(product: Product): number {
  if (!product.active) return 3;
  if (product.stock === 0) return 0;
  if (product.stock < LOW_STOCK) return 1;
  return 2;
}

/* -------------------------------------------------------------- the motion */

/** Counts from the old value to the new one, so a saved number is seen moving. */
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
    const duration = reduced ? 0 : 600;

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

function Figure({
  value,
  label,
  money = false,
  className,
}: {
  value: number;
  label: string;
  money?: boolean;
  className?: string;
}) {
  const shown = useCountUp(value);
  return (
    <div>
      <p className={cn("font-display tnum text-2xl leading-none font-semibold sm:text-[1.75rem]", className)}>
        {money ? lkr(shown) : shown}
      </p>
      <p className="text-faint mt-1.5 text-[11px]">{label}</p>
    </div>
  );
}

const FIELD =
  "bg-surface-2 border-line focus:border-saffron placeholder:text-faint w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors disabled:opacity-50";

/* --------------------------------------------------------------- the screen */

export function StockScreen({ products }: { products: Product[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [confirming, setConfirming] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const outOfStock = products.filter((p) => p.active && p.stock === 0);
  const lowStock = products.filter((p) => p.active && p.stock > 0 && p.stock < LOW_STOCK);
  const hidden = products.filter((p) => !p.active);
  const onSale = products.filter((p) => p.active);
  const anyPhotos = products.some((p) => p.photo_colours.length > 0);
  const shelfValue = onSale.reduce((sum, p) => sum + p.price_lkr * p.stock, 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = products.filter((product) => {
      if (filter === "attention" && !(product.active && product.stock < LOW_STOCK)) return false;
      if (filter === "hidden" && product.active) return false;
      if (!needle) return true;
      const haystack = [
        product.id,
        product.name,
        product.name_si ?? "",
        product.sizes.join(" "),
        product.colours.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
    return matched.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  }, [products, search, filter]);

  function runRowAction(id: string, action: () => Promise<ActionResult>, success: string) {
    setBusyId(id);
    start(async () => {
      const result = await action();
      setBusyId(null);
      if (result.ok) {
        toast.success(success, { description: "The agent uses the new value on its next message." });
      } else {
        toast.error(result.error);
      }
    });
  }

  const filters: { id: Filter; label: string; count: number; tone: string }[] = [
    { id: "all", label: "All", count: products.length, tone: "chip-muted" },
    {
      id: "attention",
      label: "Needs stock",
      count: outOfStock.length + lowStock.length,
      tone: outOfStock.length > 0 ? "chip-rose" : "chip-saffron",
    },
    { id: "hidden", label: "Hidden", count: hidden.length, tone: "chip-muted" },
  ];

  const trouble = outOfStock.length > 0;
  const headline = trouble
    ? outOfStock.length === 1
      ? `${outOfStock[0].name} is out of stock.`
      : `${outOfStock.length} products are out of stock.`
    : lowStock.length > 0
      ? `${lowStock.length} running low.`
      : "Everything is on the shelf.";

  return (
    <div>
      <section
        className={cn(
          "rise glass relative overflow-hidden rounded-3xl p-6 sm:p-8",
          trouble && "glow-rose",
        )}
        style={{ "--i": 1 } as React.CSSProperties}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-25 blur-3xl"
          style={{ background: trouble ? "var(--rose)" : "var(--grad-money)" }}
        />

        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <span className={cn("chip", trouble ? "chip-rose" : lowStock.length > 0 ? "chip-saffron" : "chip-teal")}>
                <span className={cn("size-1.5 rounded-full bg-current", trouble && "breathe")} />
                {trouble
                  ? `${outOfStock.length} out of stock`
                  : lowStock.length > 0
                    ? `${lowStock.length} running low`
                    : "Fully stocked"}
              </span>

              <h1
                className={cn(
                  "font-display mt-4 max-w-[18ch] text-[1.75rem] leading-[1.12] font-semibold tracking-tight sm:text-4xl",
                  trouble ? "text-rose" : "text-grad-money",
                )}
              >
                {headline}
              </h1>

              <p className="text-dim mt-3 max-w-[52ch] text-sm">
                {trouble
                  ? outOfStock.length === 1
                    ? "The agent is refusing every order for it, and saying so in the chat. Put a number back in and it starts selling again on its next message."
                    : "The agent is refusing every order for them, and saying so in the chat. Put numbers back in and it starts selling again on its next message."
                  : "These are the prices and counts the agent quotes. A wrong number here reaches a customer in the next message."}
              </p>
            </div>

            <button
              type="button"
              onClick={() => setEditing("new")}
              className="bg-saffron shrink-0 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-[#1a1206] shadow-[0_10px_30px_-12px_var(--saffron)] transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <PlusIcon className="mr-1.5 -ml-0.5 inline size-4 align-[-3px]" />
              Add product
            </button>
          </div>

          <div className="border-line mt-7 flex flex-wrap gap-x-9 gap-y-5 border-t pt-5">
            <Figure value={shelfValue} label="On the shelf, at retail" money className="text-grad-money" />
            <Figure value={onSale.length} label="On sale" className="text-teal" />
            <Figure value={lowStock.length} label="Running low" className={lowStock.length > 0 ? "text-saffron" : "text-faint"} />
            <Figure value={outOfStock.length} label="Out of stock" className={outOfStock.length > 0 ? "text-rose" : "text-faint"} />
            <Figure value={hidden.length} label="Hidden from agent" className="text-faint" />
          </div>
        </div>
      </section>

      <div
        className="rise glass mt-5 flex flex-wrap items-center gap-2 rounded-2xl p-2.5"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <label className="relative min-w-[13rem] flex-1">
          <SearchIcon className="text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code, name or colour"
            aria-label="Search products"
            className="bg-surface-2 border-line focus:border-saffron placeholder:text-faint w-full rounded-xl border py-2 pr-3 pl-9 text-sm outline-none transition-colors"
          />
        </label>

        <div className="flex flex-wrap items-center gap-1.5">
          {filters.map((option) => {
            const on = filter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(option.id)}
                className={cn(
                  "chip cursor-pointer transition-all hover:brightness-125",
                  on ? "bg-surface-3 border-line-strong text-foreground" : option.tone,
                  on && "shadow-[0_6px_18px_-10px_rgb(0_0_0/0.9)]",
                )}
              >
                {option.label}
                <span className="tnum opacity-70">{option.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p
          className="rise glass text-dim mt-5 rounded-2xl px-6 py-10 text-center text-sm"
          style={{ "--i": 3 } as React.CSSProperties}
        >
          {products.length === 0
            ? "No products yet. Add the first one — the agent cannot quote what is not here."
            : "Nothing matches that filter."}
        </p>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((product, index) => (
            <ProductCard
              key={product.id}
              product={product}
              index={Math.min(index, 9)}
              anyPhotos={anyPhotos}
              busy={pending && busyId === product.id}
              disabled={pending}
              onEdit={() => setEditing(product)}
              onToggle={() =>
                runRowAction(
                  product.id,
                  () => toggleActive(product.id, !product.active),
                  product.active
                    ? `${product.id} is hidden from the agent.`
                    : `${product.id} is back on sale.`,
                )
              }
              onDelete={() => setConfirming(product)}
            />
          ))}
        </div>
      )}

      <p className="text-faint mt-6 max-w-[72ch] text-xs leading-relaxed">
        Deactivating keeps a product on past orders but stops the agent offering it. Deleting is only
        possible while nothing has ever been ordered.
        {anyPhotos
          ? " Photo counts come from the agent data/product-photos.json index and are not edited here."
          : null}
      </p>

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
          {editing === null ? null : (
            <ProductForm
              key={editing === "new" ? "new" : editing.id}
              product={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => (open ? null : setConfirming(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirming?.id}?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.name} disappears from the catalog for good. Nobody has ordered it, so
              nothing else breaks — but if you only want it off sale, deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const target = confirming;
                if (!target) return;
                setConfirming(null);
                runRowAction(target.id, () => removeProduct(target.id), `${target.id} deleted.`);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ----------------------------------------------------------------- the card */

function ProductCard({
  product,
  index,
  anyPhotos,
  busy,
  disabled,
  onEdit,
  onToggle,
  onDelete,
}: {
  product: Product;
  index: number;
  anyPhotos: boolean;
  busy: boolean;
  disabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const tone = stockTone(product.stock);
  const empty = product.active && product.stock === 0;

  return (
    <article
      className={cn(
        "rise glass glass-hover relative flex flex-col overflow-hidden rounded-2xl p-5 transition-opacity",
        empty && "glow-rose",
        !product.active && "opacity-60",
        busy && "opacity-40",
      )}
      style={{ "--i": index + 3 } as React.CSSProperties}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 opacity-80"
        style={{ background: product.active ? tone.accent : "var(--line-strong)" }}
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-faint font-mono text-[11px] tracking-wide">{product.id}</span>
        <span className={cn("chip", product.active ? tone.chip : "chip-muted")}>
          {empty ? <span className="breathe size-1.5 rounded-full bg-current" /> : null}
          {product.active ? tone.label : "Hidden from agent"}
        </span>
      </div>

      <h2 className="font-display mt-2 text-base leading-snug font-semibold tracking-tight">
        {product.name}
      </h2>
      {product.name_si ? (
        <p className="text-faint mt-0.5 text-xs" lang="si">
          {product.name_si}
        </p>
      ) : null}

      <p className="font-display tnum text-saffron mt-3 text-2xl leading-none font-semibold">
        {lkr(product.price_lkr)}
      </p>

      {product.sizes.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="text-faint w-full text-[10px] tracking-[0.14em] uppercase">Sizes</span>
          {product.sizes.map((size) => (
            <span
              key={size}
              className="bg-surface-2 border-line tnum rounded-lg border px-2 py-0.5 text-xs"
            >
              {size}
            </span>
          ))}
        </div>
      ) : null}

      {product.colours.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-faint w-full text-[10px] tracking-[0.14em] uppercase">Colours</span>
          {product.colours.map((colour) => (
            <span
              key={colour}
              className="bg-surface-2 border-line text-dim inline-flex items-center gap-1.5 rounded-lg border py-0.5 pr-2 pl-1.5 text-xs"
            >
              <ColourDot name={colour} />
              {colour}
            </span>
          ))}
        </div>
      ) : null}

      {product.sizes.length === 0 && product.colours.length === 0 ? (
        <p className="text-faint mt-4 text-xs">No sizes or colours yet.</p>
      ) : null}

      <div className="border-line mt-5 flex items-center justify-between gap-2 border-t pt-3">
        <span className="text-faint text-[11px]" title={product.updated_at}>
          {product.updated_label}
          {anyPhotos
            ? product.photo_colours.length > 0
              ? ` · ${product.photo_colours.length} photos`
              : " · no photos"
            : null}
        </span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="text-dim hover:text-foreground hover:bg-surface-2 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
          >
            Edit
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${product.id}`}
                className="text-faint hover:text-foreground hover:bg-surface-2 grid size-7 cursor-pointer place-items-center rounded-lg transition-colors"
              >
                <MoreHorizontalIcon className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
              <DropdownMenuItem disabled={disabled} onSelect={onToggle}>
                {product.active ? "Deactivate" : "Activate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {product.order_lines > 0 ? (
                <>
                  <DropdownMenuItem disabled>Delete</DropdownMenuItem>
                  <DropdownMenuLabel className="text-faint max-w-56 text-xs font-normal whitespace-normal">
                    On {product.order_lines} order line{product.order_lines === 1 ? "" : "s"} —
                    deleting would break those orders. Deactivate instead.
                  </DropdownMenuLabel>
                </>
              ) : (
                <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={onDelete}>
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}

/* ----------------------------------------------------------------- the form */

function ProductForm({ product, onDone }: { product: Product | null; onDone: () => void }) {
  const [id, setId] = useState(product?.id ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [nameSi, setNameSi] = useState(product?.name_si ?? "");
  const [price, setPrice] = useState(product ? String(product.price_lkr) : "");
  const [stock, setStock] = useState(product ? String(product.stock) : "0");
  const [sizes, setSizes] = useState(product ? product.sizes.join(", ") : "");
  const [colours, setColours] = useState(product ? product.colours.join(", ") : "");
  const [active, setActive] = useState(product?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const willBeEmpty = stock.replace(/[\s,]/g, "") === "0";

  function submit() {
    setError(null);
    const draft = { id, name, nameSi, price, stock, sizes, colours, active };
    start(async () => {
      const result = product === null ? await addProduct(draft) : await editProduct(draft);
      if (result.ok) {
        toast.success(product === null ? `${id.trim()} added.` : `${id.trim()} saved.`, {
          description: "The agent quotes the new values on its next message.",
        });
        onDone();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="font-display text-lg font-semibold tracking-tight">
          {product === null ? "Add product" : `Edit ${product.id}`}
        </DialogTitle>
        <DialogDescription className="text-dim">
          These are the numbers the agent quotes in WhatsApp. Saving takes effect on its next
          message.
        </DialogDescription>
      </DialogHeader>

      <div className="my-5 space-y-4">
        {error ? (
          <p role="alert" className="chip chip-rose w-full !rounded-xl !px-3 !py-2 !text-sm">
            {error}
          </p>
        ) : null}

        <div className="grid gap-1.5">
          <label htmlFor="product-id" className="text-sm font-medium">
            Product code
          </label>
          <input
            id="product-id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            disabled={product !== null || pending}
            placeholder="TS-003"
            autoComplete="off"
            className={cn(FIELD, "font-mono")}
          />
          <p className="text-faint text-xs">
            {product === null
              ? "Letters, numbers, dots and dashes. Orders will point at this, so it cannot be changed afterwards."
              : "Orders reference this code, so it cannot be changed."}
          </p>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="product-name" className="text-sm font-medium">
            Name
          </label>
          <input
            id="product-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            placeholder="Plain Cotton T-Shirt"
            className={FIELD}
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="product-name-si" className="text-sm font-medium">
            Sinhala name
          </label>
          <input
            id="product-name-si"
            value={nameSi}
            onChange={(event) => setNameSi(event.target.value)}
            disabled={pending}
            lang="si"
            placeholder="Optional"
            className={FIELD}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <label htmlFor="product-price" className="text-sm font-medium">
              Price (LKR)
            </label>
            <input
              id="product-price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={pending}
              inputMode="numeric"
              placeholder="1890"
              className={cn(FIELD, "tnum text-saffron font-semibold")}
            />
            <p className="text-faint text-xs">Whole rupees.</p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="product-stock" className="text-sm font-medium">
              Stock
            </label>
            <input
              id="product-stock"
              value={stock}
              onChange={(event) => setStock(event.target.value)}
              disabled={pending}
              inputMode="numeric"
              placeholder="0"
              className={cn(
                FIELD,
                "tnum font-semibold",
                willBeEmpty ? "text-rose border-rose/40" : "text-teal",
              )}
            />
            <p className={cn("text-xs", willBeEmpty ? "text-rose" : "text-faint")}>
              {willBeEmpty ? "At zero the agent refuses every order." : "Units on hand."}
            </p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="product-sizes" className="text-sm font-medium">
            Sizes
          </label>
          <input
            id="product-sizes"
            value={sizes}
            onChange={(event) => setSizes(event.target.value)}
            disabled={pending}
            placeholder="S, M, L, XL"
            className={FIELD}
          />
          <ListPreview raw={sizes} empty="No sizes yet. Separate them with commas." />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="product-colours" className="text-sm font-medium">
            Colours
          </label>
          <input
            id="product-colours"
            value={colours}
            onChange={(event) => setColours(event.target.value)}
            disabled={pending}
            placeholder="Black, White, Navy"
            className={FIELD}
          />
          <ListPreview
            raw={colours}
            empty="No colours yet. Separate them with commas."
            swatches
          />
        </div>

        <div className="bg-surface-2 border-line flex items-start justify-between gap-6 rounded-xl border p-3.5">
          <div>
            <p className="text-sm font-medium">On sale</p>
            <p className="text-dim mt-0.5 max-w-[42ch] text-sm leading-snug">
              Off means the agent stops offering it and stops quoting its price. Past orders keep it.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={active}
            aria-label="On sale"
            disabled={pending}
            onClick={() => setActive(!active)}
            className={cn(
              "relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-all disabled:opacity-50",
              active ? "bg-teal shadow-[0_0_18px_-4px_var(--teal)]" : "bg-surface-3",
            )}
          >
            <span
              className={cn(
                "absolute top-1 size-5 rounded-full bg-white transition-transform duration-200",
                active ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </div>

      <DialogFooter>
        <button
          type="button"
          onClick={onDone}
          disabled={pending}
          className="text-dim hover:text-foreground hover:bg-surface-2 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="bg-saffron cursor-pointer rounded-xl px-4 py-2.5 text-sm font-semibold text-[#1a1206] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Saving…" : product === null ? "Add product" : "Save changes"}
        </button>
      </DialogFooter>
    </form>
  );
}

/** Shows exactly what the comma-separated text becomes once saved. */
function ListPreview({
  raw,
  empty,
  swatches = false,
}: {
  raw: string;
  empty: string;
  swatches?: boolean;
}) {
  const values = parseList(raw);
  if (values.length === 0) return <p className="text-faint text-xs">{empty}</p>;

  if (swatches) {
    return (
      <p className="text-faint flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span>Saves as</span>
        {values.map((value) => (
          <span key={value} className="text-foreground inline-flex items-center gap-1.5">
            <ColourDot name={value} className="size-2.5" />
            {value}
          </span>
        ))}
      </p>
    );
  }

  return (
    <p className="text-faint text-xs">
      Commas separate. Saves as <span className="text-foreground">{values.join(" · ")}</span>
    </p>
  );
}
