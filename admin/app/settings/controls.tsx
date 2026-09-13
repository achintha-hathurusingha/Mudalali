"use client";

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { updateSetting } from "@/app/actions";
import { INTENTS, NEVER_AUTOMATED, type SettingKey } from "@/lib/settings-shared";
import { cn } from "@/lib/utils";

function useSetting(key: SettingKey) {
  const [pending, start] = useTransition();
  const save = (value: string, said: string) =>
    start(async () => {
      try {
        await updateSetting(key, value);
        toast.success(said, { description: "The agent has it within a few seconds." });
      } catch {
        toast.error("Not saved.", { description: "Nothing changed. Try again." });
      }
    });
  return { save, pending };
}

/* ---------------------------------------------------------------- the row */

/**
 * One ruled line of the ledger: name in the margin, value in the field.
 * Every setting uses this shape, so the page reads as one column of figures
 * rather than a stack of unrelated boxes.
 */
function Row({
  name,
  help,
  children,
}: {
  name: string;
  help: string;
  children: ReactNode;
}) {
  return (
    <div className="rule-row grid grid-cols-[1fr_auto] items-baseline gap-x-6 gap-y-1 py-4">
      <div>
        <p className="text-[0.9375rem] leading-snug font-medium">{name}</p>
        <p className="text-ink-soft mt-0.5 max-w-[52ch] text-sm leading-snug">{help}</p>
      </div>
      <div className="figures justify-self-end">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------- the state */

/** The one loud thing on the page: what the shop is doing right now. */
export function ShopState({
  paused,
  mode,
  autoCount,
}: {
  paused: boolean;
  mode: string;
  autoCount: number;
}) {
  const [isPaused, setPaused] = useState(paused);
  const { save, pending } = useSetting("paused");

  const headline = isPaused
    ? "Nobody is being answered."
    : mode === "auto"
      ? `Answering ${autoCount} kind${autoCount === 1 ? "" : "s"} of message on its own.`
      : "Every reply is waiting for you.";

  const sub = isPaused
    ? "Messages still arrive and are recorded. Nothing goes back out."
    : mode === "auto"
      ? "Orders, bargaining and complaints still come to you."
      : "Nothing reaches a customer until you approve it.";

  return (
    <section className="border-rule-strong mb-12 border-b pb-8">
      <h1
        className={cn(
          "font-display max-w-[18ch] text-4xl leading-[1.05] tracking-tight sm:text-5xl",
          isPaused && "text-stop",
        )}
      >
        {headline}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
        <p className="text-ink-soft max-w-[46ch] text-sm">{sub}</p>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const next = !isPaused;
            setPaused(next);
            save(String(next), next ? "Stopped. Nothing is going out." : "Replying again.");
          }}
          className={cn(
            "cursor-pointer border-b-2 pb-0.5 text-sm font-medium transition-colors disabled:opacity-50",
            isPaused
              ? "border-settled text-settled hover:border-ink hover:text-ink"
              : "border-stop text-stop hover:border-ink hover:text-ink",
          )}
        >
          {isPaused ? "Start replying" : "Stop replying"}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- the fields */

export function ModeControl({ mode }: { mode: string }) {
  const [value, setValue] = useState(mode);
  const { save, pending } = useSetting("mode");

  const options = [
    { id: "suggest", label: "Suggest", note: "you approve each one" },
    { id: "auto", label: "Auto", note: "safe replies go alone" },
  ];

  return (
    <Row name="Reply mode" help="Suggest is where to start. Move to Auto once you trust what you have been approving.">
      <div className="flex items-baseline gap-5">
        {options.map((option) => {
          const on = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={pending}
              onClick={() => {
                setValue(option.id);
                save(option.id, `Reply mode is ${option.label}.`);
              }}
              className="cursor-pointer text-right disabled:opacity-50"
            >
              <span
                className={cn(
                  "block text-[0.9375rem] transition-colors",
                  on ? "border-ink border-b-2 pb-0.5 font-medium" : "text-ink-faint hover:text-ink",
                )}
              >
                {option.label}
              </span>
              {on ? <span className="text-ink-soft mt-1 block text-xs">{option.note}</span> : null}
            </button>
          );
        })}
      </div>
    </Row>
  );
}

export function AutoIntentsControl({ selected }: { selected: string[] }) {
  const [value, setValue] = useState(selected);
  const { save, pending } = useSetting("autoIntents");

  const toggle = (intent: string) => {
    const next = value.includes(intent) ? value.filter((i) => i !== intent) : [...value, intent];
    setValue(next);
    save(next.join(","), `${label(intent)} ${next.includes(intent) ? "answers itself" : "comes to you"}.`);
  };

  return (
    <div className="rule-row py-4">
      <p className="text-[0.9375rem] font-medium">Which messages may answer themselves</p>
      <p className="text-ink-soft mt-0.5 max-w-[58ch] text-sm leading-snug">
        Only in Auto mode. The three struck through always reach you — those are relationship
        moments, not classification problems.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {INTENTS.map((intent) => {
          const locked = (NEVER_AUTOMATED as readonly string[]).includes(intent);
          const on = value.includes(intent) && !locked;
          return (
            <button
              key={intent}
              type="button"
              disabled={locked || pending}
              onClick={() => toggle(intent)}
              title={locked ? "Always handled by a person" : undefined}
              className={cn(
                "text-[0.9375rem] transition-colors",
                locked && "text-ink-faint cursor-not-allowed line-through",
                !locked && on && "border-settled cursor-pointer border-b-2 pb-0.5 font-medium",
                !locked && !on && "text-ink-faint hover:text-ink cursor-pointer",
              )}
            >
              {label(intent)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function label(intent: string): string {
  return intent.replace(/_/g, " ");
}

export function ToggleControl({
  settingKey,
  name,
  help,
  value,
  onWord = "yes",
  offWord = "no",
}: {
  settingKey: SettingKey;
  name: string;
  help: string;
  value: boolean;
  onWord?: string;
  offWord?: string;
}) {
  const [on, setOn] = useState(value);
  const { save, pending } = useSetting(settingKey);

  return (
    <Row name={name} help={help}>
      <button
        type="button"
        disabled={pending}
        aria-pressed={on}
        onClick={() => {
          setOn(!on);
          save(String(!on), `${name}: ${!on ? onWord : offWord}.`);
        }}
        className={cn(
          "min-w-[4ch] cursor-pointer border-b-2 pb-0.5 text-[0.9375rem] font-medium transition-colors disabled:opacity-50",
          on ? "border-settled text-settled" : "border-rule-strong text-ink-faint hover:text-ink",
        )}
      >
        {on ? onWord : offWord}
      </button>
    </Row>
  );
}

export function NumberControl({
  settingKey,
  name,
  help,
  value,
  step = 1,
  min,
  max,
  unit,
}: {
  settingKey: SettingKey;
  name: string;
  help: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const { save, pending } = useSetting(settingKey);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === "") {
      setDraft(String(value));
      toast.error("That is not a number.", { description: "Left as it was." });
      return;
    }
    if (n === value) return;
    save(String(n), `${name}: ${n}${unit ? ` ${unit}` : ""}.`);
  };

  return (
    <Row name={name} help={help}>
      <span className="inline-flex items-baseline gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          aria-label={name}
          step={step}
          min={min}
          max={max}
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="border-rule-strong focus:border-ink w-[6ch] border-b-2 bg-transparent pb-0.5 text-right text-[0.9375rem] font-medium tabular-nums outline-none disabled:opacity-50"
        />
        {unit ? <span className="text-ink-faint text-sm">{unit}</span> : null}
      </span>
    </Row>
  );
}
