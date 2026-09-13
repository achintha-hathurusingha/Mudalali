"use client";

import { useMemo, useState, useTransition } from "react";
import { MoreHorizontalIcon, PlusIcon } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

/** Deterministic grouping, so the server and the browser render the same string. */
function rupees(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
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

function StockCell({ stock }: { stock: number }) {
  if (stock === 0) return <Badge variant="destructive">Out of stock</Badge>;
  if (stock < LOW_STOCK) {
    return (
      <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">
        Low &middot; {stock}
      </Badge>
    );
  }
  return <span className="tabular-nums">{stock}</span>;
}

function Chips({ values }: { values: string[] }) {
  if (values.length === 0) return <span className="text-muted-foreground">&mdash;</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <span key={value} className="rounded border px-1.5 py-0.5 text-xs whitespace-nowrap">
          {value}
        </span>
      ))}
    </div>
  );
}

export function CatalogTable({ products }: { products: Product[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const [confirming, setConfirming] = useState<Product | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const outOfStock = products.filter((p) => p.active && p.stock === 0);
  const lowStock = products.filter((p) => p.active && p.stock > 0 && p.stock < LOW_STOCK);
  const hidden = products.filter((p) => !p.active);
  const anyPhotos = products.some((p) => p.photo_colours.length > 0);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter((product) => {
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

  const filters: { id: Filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: products.length },
    { id: "attention", label: "Needs stock", count: outOfStock.length + lowStock.length },
    { id: "hidden", label: "Hidden", count: hidden.length },
  ];

  return (
    <div>
      {outOfStock.length > 0 ? (
        <div className="border-destructive/50 bg-destructive/5 text-destructive mb-4 rounded-lg border px-3 py-2 text-sm">
          {outOfStock.length === 1
            ? `${outOfStock[0].id} ${outOfStock[0].name} is out of stock. The agent is refusing orders for it.`
            : `${outOfStock.length} products are out of stock. The agent is refusing orders for them.`}
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search code, name or colour"
          aria-label="Search products"
          className="h-8 w-full sm:w-64"
        />
        <div className="flex items-center gap-1">
          {filters.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setFilter(option.id)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm transition-colors",
                filter === option.id ? "border-foreground bg-accent" : "hover:bg-accent/50",
                option.id === "attention" &&
                  option.count > 0 &&
                  filter !== option.id &&
                  "text-destructive",
              )}
            >
              {option.label} {option.count}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto h-8" onClick={() => setEditing("new")}>
          <PlusIcon />
          Add product
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="w-28">Stock</TableHead>
              <TableHead>Sizes</TableHead>
              <TableHead>Colours</TableHead>
              <TableHead className="w-24">Updated</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground py-8 text-center text-sm">
                  {products.length === 0
                    ? "No products yet. Add the first one - the agent cannot quote what is not here."
                    : "Nothing matches that filter."}
                </TableCell>
              </TableRow>
            ) : null}

            {visible.map((product) => (
              <TableRow
                key={product.id}
                className={cn(
                  product.active && product.stock === 0 && "bg-destructive/5",
                  !product.active && "opacity-60",
                  pending && busyId === product.id && "opacity-50",
                )}
              >
                <TableCell className="align-top">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{product.name}</span>
                    {product.active ? null : <Badge variant="outline">Hidden from agent</Badge>}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    <span className="font-mono">{product.id}</span>
                    {product.name_si ? <span> &middot; {product.name_si}</span> : null}
                    {anyPhotos ? (
                      <span>
                        {" "}
                        &middot;{" "}
                        {product.photo_colours.length > 0
                          ? `${product.photo_colours.length} photos`
                          : "no photos"}
                      </span>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-right align-top whitespace-nowrap tabular-nums">
                  Rs {rupees(product.price_lkr)}
                </TableCell>
                <TableCell className="align-top">
                  <StockCell stock={product.stock} />
                </TableCell>
                <TableCell className="align-top">
                  <Chips values={product.sizes} />
                </TableCell>
                <TableCell className="align-top">
                  <Chips values={product.colours} />
                </TableCell>
                <TableCell
                  className="text-muted-foreground align-top text-xs whitespace-nowrap"
                  title={product.updated_at}
                >
                  {product.updated_label}
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7"
                      onClick={() => setEditing(product)}
                    >
                      Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`More actions for ${product.id}`}
                        >
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onCloseAutoFocus={(event) => event.preventDefault()}
                      >
                        <DropdownMenuItem
                          disabled={pending}
                          onSelect={() =>
                            runRowAction(
                              product.id,
                              () => toggleActive(product.id, !product.active),
                              product.active
                                ? `${product.id} is hidden from the agent.`
                                : `${product.id} is back on sale.`,
                            )
                          }
                        >
                          {product.active ? "Deactivate" : "Activate"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {product.order_lines > 0 ? (
                          <>
                            <DropdownMenuItem disabled>Delete</DropdownMenuItem>
                            <DropdownMenuLabel className="text-muted-foreground max-w-56 text-xs font-normal whitespace-normal">
                              On {product.order_lines} order line
                              {product.order_lines === 1 ? "" : "s"} - deleting would break those
                              orders. Deactivate instead.
                            </DropdownMenuLabel>
                          </>
                        ) : (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={pending}
                            onSelect={() => setConfirming(product)}
                          >
                            Delete
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground mt-3 text-xs">
        Deactivating keeps a product on past orders but stops the agent offering it. Deleting is only
        possible while nothing has ever been ordered.
        {anyPhotos
          ? " Photo counts come from the agent data/product-photos.json index and are not edited here."
          : null}
      </p>

      <Dialog open={editing !== null} onOpenChange={(open) => (open ? null : setEditing(null))}>
        <DialogContent className="sm:max-w-lg">
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
              nothing else breaks - but if you only want it off sale, deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
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
        <DialogTitle>{product === null ? "Add product" : `Edit ${product.id}`}</DialogTitle>
        <DialogDescription>
          These are the numbers the agent quotes in WhatsApp. Saving takes effect on its next
          message.
        </DialogDescription>
      </DialogHeader>

      <div className="my-4 space-y-4">
        {error ? (
          <p
            role="alert"
            className="border-destructive/50 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        <div className="grid gap-2">
          <Label htmlFor="product-id">Product code</Label>
          <Input
            id="product-id"
            value={id}
            onChange={(event) => setId(event.target.value)}
            disabled={product !== null || pending}
            placeholder="TS-003"
            autoComplete="off"
            className="font-mono"
          />
          <p className="text-muted-foreground text-xs">
            {product === null
              ? "Letters, numbers, dots and dashes. Orders will point at this, so it cannot be changed afterwards."
              : "Orders reference this code, so it cannot be changed."}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            placeholder="Plain Cotton T-Shirt"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-name-si">Sinhala name</Label>
          <Input
            id="product-name-si"
            value={nameSi}
            onChange={(event) => setNameSi(event.target.value)}
            disabled={pending}
            lang="si"
            placeholder="Optional"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="product-price">Price (LKR)</Label>
            <Input
              id="product-price"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={pending}
              inputMode="numeric"
              placeholder="1890"
              className="tabular-nums"
            />
            <p className="text-muted-foreground text-xs">Whole rupees.</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="product-stock">Stock</Label>
            <Input
              id="product-stock"
              value={stock}
              onChange={(event) => setStock(event.target.value)}
              disabled={pending}
              inputMode="numeric"
              placeholder="0"
              className="tabular-nums"
            />
            <p className={cn("text-xs", willBeEmpty ? "text-destructive" : "text-muted-foreground")}>
              {willBeEmpty ? "At zero the agent refuses every order." : "Units on hand."}
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-sizes">Sizes</Label>
          <Input
            id="product-sizes"
            value={sizes}
            onChange={(event) => setSizes(event.target.value)}
            disabled={pending}
            placeholder="S, M, L, XL"
          />
          <ListPreview raw={sizes} empty="No sizes yet. Separate them with commas." />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="product-colours">Colours</Label>
          <Input
            id="product-colours"
            value={colours}
            onChange={(event) => setColours(event.target.value)}
            disabled={pending}
            placeholder="Black, White, Navy"
          />
          <ListPreview raw={colours} empty="No colours yet. Separate them with commas." />
        </div>

        <div className="flex items-start justify-between gap-6 rounded-lg border p-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">On sale</p>
            <p className="text-muted-foreground text-sm">
              Off means the agent stops offering it and stops quoting its price. Past orders keep it.
            </p>
          </div>
          <Switch
            checked={active}
            onCheckedChange={setActive}
            disabled={pending}
            aria-label="On sale"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving" : product === null ? "Add product" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Shows exactly what the comma-separated text becomes once saved. */
function ListPreview({ raw, empty }: { raw: string; empty: string }) {
  const values = parseList(raw);
  return (
    <p className="text-muted-foreground text-xs">
      {values.length === 0 ? (
        empty
      ) : (
        <span>
          Commas separate. Saves as{" "}
          <span className="text-foreground">{values.join(" · ")}</span>
        </span>
      )}
    </p>
  );
}
