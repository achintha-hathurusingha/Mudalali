"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveDraft, editDraft, skipDraft } from "./actions";
import { cn } from "@/lib/utils";

/**
 * The queue the owner works through. Everything the screen renders arrives as
 * props from the server component - this file must never reach for the
 * database, directly or through lib/approvals, or `pg` follows it into the
 * browser bundle and Turbopack fails with a missing-manifest error that points
 * nowhere near the cause. The row shapes are declared here for the same
 * reason: lib/approvals borrows them with a type-only import.
 *
 * Colour carries meaning and nothing else: violet is the agent's own words,
 * saffron is waiting, teal is settled, rose is a thing that cannot proceed.
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

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function intentLabel(intent: string): string {
  return intent.replace(/_/g, " ");
}

/**
 * One scale, used for every edit rate on the screen: teal while the drafts are
 * landing, saffron once you are rewriting a quarter of them, rose at half -
 * where the honest reading is that the prompt is wrong, not the owner.
 */
function toneFor(rate: number) {
  if (rate >= 50) return { text: "text-rose", chip: "chip-rose", colour: "var(--rose)", word: "the prompt is wrong" };
  if (rate >= 25)
    return { text: "text-saffron", chip: "chip-saffron", colour: "var(--saffron)", word: "worth watching" };
  return { text: "text-teal", chip: "chip-teal", colour: "var(--teal)", word: "the drafts are landing" };
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

function Hint({ keys, children }: { keys: string[]; children: React.ReactNode }) {
  return (
    <span className="chip chip-muted">
      <span className="flex items-center gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className="border-line bg-surface-3 text-foreground rounded-[5px] border px-1 font-mono text-[10px] leading-4"
          >
            {key}
          </kbd>
        ))}
      </span>
      {children}
    </span>
  );
}

function Label({ children, tone }: { children: React.ReactNode; tone?: "violet" }) {
  return (
    <p
      className={cn(
        "mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] uppercase",
        tone === "violet" ? "text-violet" : "text-faint",
      )}
    >
      {tone === "violet" ? <span className="bg-violet size-1.5 rounded-full" aria-hidden /> : null}
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ the hero */

/**
 * The edit rate, by intent. Of the drafts the owner let through, how many did
 * they have to rewrite first - the one number that says where the prompt is
 * wrong. Skips are counted separately: a skip is usually a conversation that
 * moved on, not a bad draft.
 */
export function EditRateHero({ rates, waiting }: { rates: EditRate[]; waiting: number }) {
  const sent = rates.reduce((total, row) => total + row.sent, 0);
  const edited = rates.reduce((total, row) => total + row.edited, 0);
  const skipped = rates.reduce((total, row) => total + row.skipped, 0);
  const approved = sent + edited;
  const rate = percent(edited, approved);
  const tone = toneFor(rate);
  const shown = rates.filter((row) => row.sent + row.edited > 0);

  // The bars grow from nothing on the first paint, so the shape of the number
  // arrives rather than simply being there.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      className="rise glass relative overflow-hidden rounded-3xl p-6 sm:p-8"
      style={{ "--i": 1 } as React.CSSProperties}
      aria-labelledby="edit-rate"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-28 -right-20 size-72 rounded-full opacity-25 blur-3xl"
        style={{ background: "var(--grad-agent)" }}
      />

      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-violet">Edit rate</span>
          {waiting > 0 ? (
            <span className="chip chip-saffron">
              <span className="breathe size-1.5 rounded-full bg-current" aria-hidden />
              {waiting} waiting
            </span>
          ) : (
            <span className="chip chip-teal">queue clear</span>
          )}
          {approved > 0 ? <span className={cn("chip", tone.chip)}>{tone.word}</span> : null}
        </div>

        {approved === 0 ? (
          <>
            <h1 id="edit-rate" className="font-display text-grad-agent mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Nothing approved yet.
            </h1>
            <p className="text-dim mt-3 max-w-[54ch] text-sm leading-relaxed">
              Once you have let a few drafts through, this shows how often you had to rewrite one
              first - broken down by intent, so you can see which part of the prompt is wrong.
            </p>
          </>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
              <h1 id="edit-rate" className="font-display leading-[0.9]">
                <span className="text-grad-agent tnum text-6xl font-semibold tracking-tight sm:text-7xl">
                  {rate}
                  <span className="text-4xl sm:text-5xl">%</span>
                </span>
                <span className="sr-only"> edit rate</span>
              </h1>
              <p className="text-dim mb-1.5 max-w-[30ch] text-sm leading-snug">
                You rewrote <span className="text-foreground tnum font-semibold">{edited}</span> of
                the <span className="text-foreground tnum font-semibold">{approved}</span> drafts you
                let through.
              </p>
            </div>

            <ul className="mt-7 space-y-3">
              {shown.map((row, index) => {
                const total = row.sent + row.edited;
                const rowRate = percent(row.edited, total);
                const rowTone = toneFor(rowRate);
                return (
                  <li key={row.intent} className="flex items-center gap-3 text-[13px]">
                    <span className="w-24 shrink-0 truncate sm:w-32" title={intentLabel(row.intent)}>
                      {intentLabel(row.intent)}
                    </span>
                    <span className="text-faint tnum hidden w-28 shrink-0 text-[11px] sm:inline">
                      {row.edited} of {total} rewritten
                    </span>
                    <span className="bg-surface-2 relative h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                      <span
                        className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
                        style={{
                          width: grown ? `${rowRate}%` : "0%",
                          background: rowTone.colour,
                          boxShadow: `0 0 14px -2px ${rowTone.colour}`,
                          transitionDelay: `${120 + index * 70}ms`,
                        }}
                      />
                    </span>
                    <span className={cn("tnum w-10 shrink-0 text-right text-xs font-medium", rowTone.text)}>
                      {rowRate}%
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="text-faint mt-6 max-w-[62ch] text-xs leading-relaxed">
              A row at or above half means the agent is usually wrong about that intent - the prompt
              needs changing, not your patience.
              {skipped > 0 ? ` ${skipped} skipped draft${skipped === 1 ? "" : "s"} not counted.` : ""}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- the queue */

export function Queue({ drafts }: { drafts: Draft[] }) {
  const [selected, setSelected] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // The card being answered, held just long enough for it to settle out of the
  // list instead of vanishing between two renders.
  const [settling, setSettling] = useState<{ id: string; kind: "sent" | "skipped" } | null>(null);
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

  // Once the answered draft is gone from the server's list there is nothing
  // left to animate out, so the mark is read through the list rather than
  // cleared by an effect - a render is all that is needed to forget it.
  const settlingId = settling && drafts.some((draft) => draft.id === settling.id) ? settling.id : null;

  const run = useCallback(
    (draft: Draft, kind: "sent" | "skipped" | null, work: () => Promise<Decision>, headline: string, note: string) => {
      if (kind) setSettling({ id: draft.id, kind });
      start(async () => {
        try {
          const result = await work();
          if (result.ok) toast.success(headline, { description: note });
          else {
            setSettling(null);
            toast.error("Nothing changed.", { description: result.reason });
          }
        } catch {
          setSettling(null);
          toast.error("Could not save that.", { description: "Nothing changed - try again." });
        }
      });
    },
    [start],
  );

  const approve = useCallback(
    (draft: Draft) =>
      run(
        draft,
        "sent",
        () => approveDraft(draft.id),
        `Approved ${draft.id}`,
        "The agent sends it within a few seconds. Nothing was sent from this screen.",
      ),
    [run],
  );

  const skip = useCallback(
    (draft: Draft) =>
      run(draft, "skipped", () => skipDraft(draft.id), `Skipped ${draft.id}`, "No reply goes out for that message."),
    [run],
  );

  const save = useCallback(
    (draft: Draft, reply: string) => {
      setEditingId(null);
      run(
        draft,
        "sent",
        () => editDraft(draft.id, reply),
        `Saved your wording for ${draft.id}`,
        "The agent sends your text instead of the draft, within a few seconds.",
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
      <div
        className="rise glass sticky top-3 z-20 mb-4 rounded-2xl px-4 py-3"
        style={{ "--i": 2 } as React.CSSProperties}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="chip chip-saffron">
            <span className="breathe size-1.5 rounded-full bg-current" aria-hidden />
            {/* Re-keyed so the count rises in again whenever the queue changes. */}
            <span key={drafts.length} className="rise">
              <span className="tnum font-semibold">{drafts.length}</span> waiting
            </span>
          </span>

          {pending ? (
            <span className="chip chip-violet breathe">recording your decision</span>
          ) : (
            <span className="hidden items-center gap-2 sm:flex">
              <Hint keys={["j", "k"]}>move</Hint>
              <Hint keys={["↵"]}>approve</Hint>
              <Hint keys={["e"]}>edit</Hint>
              <Hint keys={["s"]}>skip</Hint>
              <Hint keys={["Esc"]}>cancel an edit</Hint>
            </span>
          )}
        </div>
        <p className="text-faint mt-2 text-xs leading-relaxed">
          This screen records your decision only. The agent sends it within a few seconds, the same
          as when you replied <span className="text-dim font-mono">ok {drafts[0]?.id}</span> in
          WhatsApp.
        </p>
      </div>

      <ol className="space-y-3">
        {drafts.map((draft, index) => (
          <DraftRow
            key={draft.id}
            draft={draft}
            index={index}
            active={index === active}
            editing={editingId === draft.id}
            pending={pending}
            settling={settlingId === draft.id && settling ? settling.kind : null}
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

const BUTTON =
  "cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-default disabled:opacity-40 motion-reduce:transition-none";

function DraftRow({
  draft,
  index,
  active,
  editing,
  pending,
  settling,
  innerRef,
  onSelect,
  onApprove,
  onSkip,
  onEdit,
  onCancel,
  onSave,
}: {
  draft: Draft;
  index: number;
  active: boolean;
  editing: boolean;
  pending: boolean;
  settling: "sent" | "skipped" | null;
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
      // The row collapses as it settles, so the queue closes up behind an
      // answered draft rather than jumping.
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-500 ease-out motion-reduce:transition-none",
        settling ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
      )}
    >
      <div className={cn("min-h-0", settling && "overflow-hidden")}>
        <article
          onClick={onSelect}
          style={{ "--i": index + 3 } as React.CSSProperties}
          className={cn(
            "rise glass relative overflow-hidden rounded-2xl p-4 transition-all duration-500 ease-out sm:p-5",
            "motion-reduce:transition-none",
            !settling && "glass-hover",
            active &&
              !settling &&
              "glow-violet hover:shadow-[0_0_0_1px_rgb(167_139_250/0.45),0_20px_54px_-14px_rgb(167_139_250/0.6)]",
            settling === "sent" && "glow-teal scale-[0.98]",
            settling === "skipped" && "scale-[0.98]",
          )}
        >
          {/* Violet edge: these are the agent's words, and this one is selected. */}
          <span
            aria-hidden
            className={cn(
              "bg-violet absolute inset-y-0 left-0 w-[3px] transition-opacity duration-300 motion-reduce:transition-none",
              active && !settling ? "opacity-100" : "opacity-0",
            )}
          />

          <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="font-display text-[15px] font-semibold tracking-tight">
                  {draft.customerName}
                </h3>
                <span className="chip chip-muted font-mono text-[10px]">{draft.id}</span>
              </div>
              <p className="text-faint mt-1 text-xs" title={draft.jid || undefined}>
                {draft.contact}
                <span className="text-faint/70"> &middot; </span>
                <span>{draft.receivedAt}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <span className="chip chip-saffron tnum" title={`Received ${draft.receivedAt}`}>
                waiting {draft.waiting}
              </span>
              {draft.intent ? <span className="chip chip-sky">{intentLabel(draft.intent)}</span> : null}
              {draft.confidence !== null ? (
                <span className={cn("chip tnum", lowConfidence ? "chip-rose" : "chip-violet")}>
                  {Math.round(draft.confidence * 100)}% sure
                </span>
              ) : (
                <span className="chip chip-muted">confidence unknown</span>
              )}
              {draft.language ? (
                <span className="chip chip-muted hidden sm:inline-flex">{draft.language}</span>
              ) : null}
            </div>
          </header>

          <div className="mt-4">
            <Label>Customer</Label>
            <p className="text-[0.9375rem] leading-relaxed whitespace-pre-wrap">{draft.incoming}</p>
            {media ? (
              <p className="text-faint mt-1.5 text-xs">
                Sent as a {media}. The line above is what the agent made of it.
              </p>
            ) : null}
          </div>

          <div className="mt-4">
            <Label tone="violet">The agent&rsquo;s draft</Label>
            {editing ? (
              <textarea
                autoFocus
                id={`reply-${draft.id}`}
                name={`reply-${draft.id}`}
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={4}
                aria-label={`Reply to ${draft.customerName}`}
                className="border-violet/30 bg-violet/10 focus:border-violet/60 w-full resize-y rounded-xl border p-3.5 text-[0.9375rem] leading-relaxed outline-none transition-colors focus:shadow-[0_0_0_3px_rgb(167_139_250/0.16)] motion-reduce:transition-none"
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
              <div className="border-violet/25 bg-violet/10 rounded-xl border p-3.5">
                <p
                  className={cn(
                    "text-[0.9375rem] leading-relaxed whitespace-pre-wrap",
                    draft.reply ? "" : "text-faint italic",
                  )}
                >
                  {draft.reply || "the agent drafted nothing"}
                </p>
              </div>
            )}
          </div>

          {draft.order ? <OrderSummary order={draft.order} /> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onSave(text)}
                  className={cn(BUTTON, "bg-teal text-[#04201c] shadow-[0_10px_28px_-12px_var(--teal)] hover:brightness-110")}
                >
                  Save as edited
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onCancel}
                  className={cn(BUTTON, "text-dim hover:text-foreground hover:bg-surface-2 font-medium")}
                >
                  Cancel
                </button>
                <span className="ml-auto hidden items-center gap-2 sm:flex">
                  <Hint keys={["Ctrl", "↵"]}>saves</Hint>
                  <Hint keys={["Esc"]}>cancels</Hint>
                </span>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onApprove}
                  className={cn(BUTTON, "bg-teal text-[#04201c] shadow-[0_10px_28px_-12px_var(--teal)] hover:brightness-110")}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onEdit}
                  className={cn(BUTTON, "bg-surface-3 border-line text-foreground border hover:brightness-125")}
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={onSkip}
                  className={cn(BUTTON, "text-faint hover:text-rose hover:bg-rose/10 font-medium")}
                >
                  Skip
                </button>
                {active ? (
                  <span className="ml-auto hidden items-center gap-2 sm:flex">
                    <Hint keys={["↵"]}>approve</Hint>
                    <Hint keys={["e"]}>edit</Hint>
                    <Hint keys={["s"]}>skip</Hint>
                  </span>
                ) : null}
              </>
            )}
          </div>
        </article>
      </div>
    </li>
  );
}

function OrderSummary({ order }: { order: DraftOrder }) {
  return (
    <div className="border-line bg-surface-2/60 mt-4 rounded-xl border p-3.5">
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-[13px] font-semibold tracking-tight">
          Draft order #{order.id}
        </span>
        <span className="chip chip-muted">{order.status}</span>
      </div>

      {order.lines.length === 0 ? (
        <p className="text-faint text-xs">No items on it yet.</p>
      ) : (
        <dl className="space-y-1.5 text-sm">
          {order.lines.map((line, index) => (
            <div key={index} className="flex justify-between gap-4">
              <dt className="text-dim min-w-0">{line.description}</dt>
              <dd className="tnum shrink-0">{lkr(line.amountLkr)}</dd>
            </div>
          ))}
          {order.deliveryFeeLkr !== null ? (
            <div className="text-faint flex justify-between gap-4">
              <dt>Delivery</dt>
              <dd className="tnum shrink-0">{lkr(order.deliveryFeeLkr)}</dd>
            </div>
          ) : null}
          {order.totalLkr !== null ? (
            <div className="border-line mt-1 flex justify-between gap-4 border-t pt-2">
              <dt className="font-medium">Total</dt>
              <dd className="text-saffron tnum shrink-0 font-semibold">{lkr(order.totalLkr)}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {order.missing.length === 0 ? (
          <span className="chip chip-teal">
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            name, phone, city and address all on file
          </span>
        ) : (
          <>
            <span className="text-faint text-xs">Still to collect:</span>
            {order.missing.map((field) => (
              <span key={field} className="chip chip-rose">
                {field}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the good day */

export function EmptyQueue({ resolved }: { resolved: number }) {
  const router = useRouter();
  const [checking, start] = useTransition();

  return (
    <section
      className="rise glass relative overflow-hidden rounded-3xl p-8 text-center sm:p-12"
      style={{ "--i": 2 } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-28 left-1/2 size-80 -translate-x-1/2 rounded-full opacity-20 blur-3xl"
        style={{ background: "var(--grad-good)" }}
      />

      <div className="relative mx-auto max-w-md">
        <span className="chip chip-teal">
          <span className="breathe size-1.5 rounded-full bg-current" aria-hidden />
          all caught up
        </span>

        <h2
          className="font-display mt-4 text-2xl font-semibold tracking-tight sm:text-3xl"
          style={{
            background: "var(--grad-good)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          Nothing waiting for you.
        </h2>

        <p className="text-dim mt-3 text-sm leading-relaxed">
          A draft appears here within seconds of a customer writing in, whenever the agent wants your
          approval before it replies.
        </p>

        {resolved > 0 ? (
          <p className="text-faint mt-2 text-sm">
            <span className="text-foreground tnum font-semibold">{resolved}</span>{" "}
            {resolved === 1 ? "draft has" : "drafts have"} come through here so far.
          </p>
        ) : null}

        <button
          type="button"
          disabled={checking}
          onClick={() => start(() => router.refresh())}
          className={cn(
            BUTTON,
            "bg-surface-3 border-line text-foreground mt-6 border font-medium hover:brightness-125",
            checking && "breathe",
          )}
        >
          {checking ? "Checking…" : "Check again"}
        </button>

        <p className="text-faint mt-3 text-xs">This page is read fresh each time you open it.</p>
      </div>
    </section>
  );
}
