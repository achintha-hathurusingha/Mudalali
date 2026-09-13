"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { approveDraft, editDraft, skipDraft } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * The queue the owner works through. Everything the screen renders arrives as
 * props from the server component - this file must never reach for the
 * database, directly or through lib/approvals, or `pg` follows it into the
 * browser bundle and Turbopack fails with a missing-manifest error that points
 * nowhere near the cause. The row shapes are declared here for the same
 * reason: lib/approvals borrows them with a type-only import.
 */

export type OrderLine = {
  description: string;
  amountLkr: number;
};

export type DraftOrder = {
  id: number;
  status: string;
  lines: OrderLine[];
  deliveryFeeLkr: number | null;
  totalLkr: number | null;
  /** Contact details the agent still has to collect: name, phone, city, address. */
  missing: string[];
};

export type Draft = {
  id: string;
  customerName: string;
  contact: string;
  jid: string;
  incoming: string;
  reply: string;
  intent: string | null;
  confidence: number | null;
  language: string | null;
  mediaKind: string | null;
  receivedAt: string;
  waiting: string;
  order: DraftOrder | null;
};

export type EditRate = {
  intent: string;
  sent: number;
  edited: number;
  skipped: number;
};

type Decision = Awaited<ReturnType<typeof approveDraft>>;

/** Formatted here rather than through Intl, so server and client agree exactly. */
export function lkr(amount: number): string {
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? "-" : "";
  return `Rs. ${sign}${Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * A photo or voice note never reaches this screen - the agent has already
 * turned it into text. Say so, so the owner knows they are approving a reply
 * to a transcription they cannot check here.
 */
function attachment(draft: Draft): string | null {
  const kind = (draft.mediaKind ?? "").toLowerCase();
  if (kind.startsWith("image") || kind === "photo") return "photo";
  if (kind.startsWith("audio") || kind === "voice" || kind === "ptt") return "voice note";
  if (kind) return kind;

  const body = draft.incoming.trimStart().toLowerCase();
  if (body.startsWith("[photo")) return "photo";
  if (body.startsWith("[voice") || body.startsWith("[audio")) return "voice note";
  return null;
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted rounded border px-1 font-mono text-[11px] leading-4">{children}</kbd>
  );
}

export function Queue({ drafts }: { drafts: Draft[] }) {
  const [selected, setSelected] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const cards = useRef<Array<HTMLLIElement | null>>([]);
  const settled = useRef(false);

  // A resolved draft leaves the list on the next render, so the stored index
  // can outrun it. Clamping here means the selection lands on the next draft
  // instead of disappearing - which is what you want when working a queue.
  const active = drafts.length === 0 ? -1 : Math.min(selected, drafts.length - 1);
  const current = active === -1 ? null : drafts[active];

  useEffect(() => {
    if (!settled.current) {
      settled.current = true;
      return;
    }
    cards.current[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const run = useCallback(
    (work: () => Promise<Decision>, headline: string, note: string) => {
      start(async () => {
        try {
          const result = await work();
          if (result.ok) toast.success(headline, { description: note });
          else toast.error("Nothing changed.", { description: result.reason });
        } catch {
          toast.error("Could not save that.", { description: "Nothing changed - try again." });
        }
      });
    },
    [start],
  );

  const approve = useCallback(
    (draft: Draft) =>
      run(
        () => approveDraft(draft.id),
        `Approved ${draft.id}`,
        "The agent delivers it on its next pass. Nothing was sent from this screen.",
      ),
    [run],
  );

  const skip = useCallback(
    (draft: Draft) =>
      run(() => skipDraft(draft.id), `Skipped ${draft.id}`, "No reply goes out for that message."),
    [run],
  );

  const save = useCallback(
    (draft: Draft, reply: string) => {
      setEditingId(null);
      run(
        () => editDraft(draft.id, reply),
        `Saved your wording for ${draft.id}`,
        "The agent sends your text instead of the draft.",
      );
    },
    [run],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (editingId !== null || !current) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      // Never steal a keystroke from something being typed into, and let a
      // focused button keep its own Enter and Space.
      if (tag === "TEXTAREA" || tag === "INPUT" || target?.isContentEditable) return;
      if ((tag === "BUTTON" || tag === "A") && (event.key === "Enter" || event.key === " ")) return;

      switch (event.key) {
        case "j":
        case "ArrowDown":
          event.preventDefault();
          setSelected(Math.min(active + 1, drafts.length - 1));
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          setSelected(Math.max(active - 1, 0));
          break;
        case "Enter":
          event.preventDefault();
          if (!pending) approve(current);
          break;
        case "e":
          event.preventDefault();
          setEditingId(current.id);
          break;
        case "s":
          event.preventDefault();
          if (!pending) skip(current);
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, approve, current, drafts.length, editingId, pending, skip]);

  if (drafts.length === 0) return null;

  return (
    <section aria-label="Drafts waiting for approval">
      <div className="bg-background sticky top-0 z-10 mb-3 space-y-1 py-2">
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="text-foreground font-medium">
            {drafts.length} waiting
          </span>
          <span>
            <Key>j</Key> <Key>k</Key> move
          </span>
          <span>
            <Key>Enter</Key> approve
          </span>
          <span>
            <Key>e</Key> edit
          </span>
          <span>
            <Key>s</Key> skip
          </span>
          <span>
            <Key>Esc</Key> cancel an edit
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          This screen records your decision only. The agent delivers the message on its next pass,
          the same as when you replied <span className="font-mono">ok {drafts[0]?.id}</span> in
          WhatsApp.
        </p>
      </div>

      <ol className="space-y-3">
        {drafts.map((draft, index) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            active={index === active}
            editing={editingId === draft.id}
            pending={pending}
            innerRef={(node) => {
              cards.current[index] = node;
            }}
            onSelect={() => setSelected(index)}
            onApprove={() => approve(draft)}
            onSkip={() => skip(draft)}
            onEdit={() => {
              setSelected(index);
              setEditingId(draft.id);
            }}
            onCancel={() => setEditingId(null)}
            onSave={(reply) => save(draft, reply)}
          />
        ))}
      </ol>
    </section>
  );
}

function DraftRow({
  draft,
  active,
  editing,
  pending,
  innerRef,
  onSelect,
  onApprove,
  onSkip,
  onEdit,
  onCancel,
  onSave,
}: {
  draft: Draft;
  active: boolean;
  editing: boolean;
  pending: boolean;
  innerRef: (node: HTMLLIElement | null) => void;
  onSelect: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (reply: string) => void;
}) {
  const media = attachment(draft);
  const lowConfidence = draft.confidence !== null && draft.confidence < 0.8;

  // Reset to the agent's wording each time the editor opens, so an abandoned
  // rewrite is never silently carried into the next attempt. Adjusted during
  // render rather than in an effect - this is a render the user never sees,
  // instead of a second pass after one they do.
  const [text, setText] = useState(draft.reply);
  const [wasEditing, setWasEditing] = useState(editing);
  if (editing !== wasEditing) {
    setWasEditing(editing);
    if (editing) setText(draft.reply);
  }

  return (
    <li
      ref={innerRef}
      aria-current={active ? "true" : undefined}
      onClick={onSelect}
      className={cn(
        "rounded-lg border p-4 transition-colors",
        // The ring doubles the border without moving anything, so the keyboard
        // selection is obvious at a glance while working down the queue.
        active ? "border-foreground ring-foreground bg-accent/40 ring-1" : "hover:bg-accent/20",
      )}
    >
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-muted-foreground font-mono text-xs">{draft.id}</span>
          <span className="text-sm font-medium">{draft.customerName}</span>
          <span className="text-muted-foreground text-xs" title={draft.jid || undefined}>
            {draft.contact}
          </span>
        </div>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {draft.intent ? (
            <Badge variant="outline" className="font-normal">
              {draft.intent.replace(/_/g, " ")}
            </Badge>
          ) : null}
          {draft.confidence !== null ? (
            <span className={cn(lowConfidence && "text-destructive")}>
              {Math.round(draft.confidence * 100)}% sure
            </span>
          ) : (
            <span>confidence unknown</span>
          )}
          {draft.language ? <span>{draft.language}</span> : null}
          <span title={draft.receivedAt}>waiting {draft.waiting}</span>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-[4.5rem_1fr] gap-x-3">
          <span className="text-muted-foreground pt-px text-xs">Customer</span>
          <div>
            <p className="whitespace-pre-wrap">{draft.incoming}</p>
            {media ? (
              <p className="text-muted-foreground mt-1 text-xs">
                Sent as a {media}. The line above is what the agent made of it.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-[4.5rem_1fr] gap-x-3">
          <span className="text-muted-foreground pt-px text-xs">Draft</span>
          {editing ? (
            <Textarea
              autoFocus
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              aria-label={`Reply to ${draft.customerName}`}
              className="text-sm"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onCancel();
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSave(event.currentTarget.value);
                }
              }}
            />
          ) : (
            <p className="whitespace-pre-wrap">{draft.reply || "(the agent drafted nothing)"}</p>
          )}
        </div>
      </div>

      {draft.order ? <OrderSummary order={draft.order} /> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => onSave(text)}>
              Save as edited
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
              Cancel
            </Button>
            <span className="text-muted-foreground text-xs">
              <Key>Ctrl</Key> <Key>Enter</Key> saves, <Key>Esc</Key> cancels
            </span>
          </>
        ) : (
          <>
            <Button size="sm" disabled={pending} onClick={onApprove}>
              Approve
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={onSkip}>
              Skip
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function OrderSummary({ order }: { order: DraftOrder }) {
  return (
    <div className="mt-3 rounded-md border border-dashed p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium">Draft order #{order.id}</span>
        <span className="text-muted-foreground text-xs">{order.status}</span>
      </div>

      {order.lines.length === 0 ? (
        <p className="text-muted-foreground text-xs">No items on it yet.</p>
      ) : (
        <dl className="space-y-1 text-sm">
          {order.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-4">
              <dt className="min-w-0">{line.description}</dt>
              <dd className="shrink-0 tabular-nums">{lkr(line.amountLkr)}</dd>
            </div>
          ))}
          {order.deliveryFeeLkr !== null ? (
            <div className="text-muted-foreground flex justify-between gap-4">
              <dt>Delivery</dt>
              <dd className="shrink-0 tabular-nums">{lkr(order.deliveryFeeLkr)}</dd>
            </div>
          ) : null}
          {order.totalLkr !== null ? (
            <div className="flex justify-between gap-4 border-t pt-1 font-medium">
              <dt>Total</dt>
              <dd className="shrink-0 tabular-nums">{lkr(order.totalLkr)}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <p className="text-muted-foreground mt-2 text-xs">
        {order.missing.length === 0
          ? "Name, phone, city and address are all on file."
          : `Still to collect: ${order.missing.join(", ")}.`}
      </p>
    </div>
  );
}
