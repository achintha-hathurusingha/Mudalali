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

/* ------------------------------------------------------------------ shells */

export function Panel({
  title,
  hint,
  i = 0,
  children,
}: {
  title: string;
  hint?: string;
  i?: number;
  children: ReactNode;
}) {
  return (
    <section className="rise glass rounded-2xl p-5 sm:p-6" style={{ "--i": i } as React.CSSProperties}>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-faint text-xs">{hint}</p> : null}
      </div>
      <div className="divide-line mt-3 divide-y">{children}</div>
    </section>
  );
}

function Row({ name, help, children }: { name: string; help: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] leading-snug font-medium">{name}</p>
        <p className="text-dim mt-0.5 max-w-[54ch] text-sm leading-snug">{help}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------- the state */

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

  const live = !isPaused;
  const headline = isPaused
    ? "Nobody is being answered."
    : mode === "auto"
      ? `Answering ${autoCount} kinds of message on its own.`
      : "Every reply is waiting for you.";

  return (
    <section
      className={cn(
        "rise glass relative overflow-hidden rounded-3xl p-6 sm:p-8",
        isPaused && "glow-rose",
      )}
      style={{ "--i": 1 } as React.CSSProperties}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full opacity-25 blur-3xl"
        style={{ background: isPaused ? "var(--rose)" : "var(--grad-agent)" }}
      />

      <div className="relative">
        <span className={cn("chip", live ? "chip-teal" : "chip-rose")}>
          <span className={cn("size-1.5 rounded-full bg-current", live && "breathe")} />
          {live ? "Live" : "Stopped"}
        </span>

        <h1
          className={cn(
            "font-display mt-4 max-w-[20ch] text-[1.75rem] leading-[1.12] font-semibold tracking-tight sm:text-4xl",
            isPaused ? "text-rose" : "text-grad-agent",
          )}
        >
          {headline}
        </h1>

        <p className="text-dim mt-3 max-w-[52ch] text-sm">
          {isPaused
            ? "Messages still arrive and are recorded. Nothing goes back out until you start again."
            : mode === "auto"
              ? "Orders, bargaining and complaints still come to you."
              : "Nothing reaches a customer until you approve it."}
        </p>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const next = !isPaused;
            setPaused(next);
            save(String(next), next ? "Stopped. Nothing is going out." : "Replying again.");
          }}
          className={cn(
            "mt-6 cursor-pointer rounded-xl px-5 py-2.5 text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-50",
            isPaused
              ? "bg-teal glow-teal text-[#04201c] hover:brightness-110"
              : "bg-rose glow-rose text-white hover:brightness-110",
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
      <div className="bg-surface-2 border-line inline-flex rounded-xl border p-1">
        {options.map((option) => {
          const on = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              disabled={pending}
              title={option.note}
              onClick={() => {
                setValue(option.id);
                save(option.id, `Reply mode is ${option.label}.`);
              }}
              className={cn(
                "cursor-pointer rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all disabled:opacity-50",
                on
                  ? "bg-saffron text-[#1a1206] shadow-[0_6px_20px_-8px_var(--saffron)]"
                  : "text-dim hover:text-foreground",
              )}
            >
              {option.label}
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
    save(next.join(","), `${nice(intent)} ${next.includes(intent) ? "answers itself" : "comes to you"}.`);
  };

  return (
    <div className="py-4 first:pt-0 last:pb-0">
      <p className="text-[0.9375rem] font-medium">Which messages may answer themselves</p>
      <p className="text-dim mt-0.5 max-w-[58ch] text-sm leading-snug">
        Only in Auto mode. The three in rose always reach you — those are relationship moments, not
        classification problems.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
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
                "chip transition-all",
                locked && "chip-rose cursor-not-allowed opacity-70",
                !locked && on && "chip-teal cursor-pointer hover:brightness-125",
                !locked && !on && "chip-muted cursor-pointer hover:brightness-125",
              )}
            >
              {on ? <span className="bg-teal size-1.5 rounded-full" /> : null}
              {nice(intent)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function nice(intent: string): string {
  return intent.replace(/_/g, " ");
}

export function ToggleControl({
  settingKey,
  name,
  help,
  value,
}: {
  settingKey: SettingKey;
  name: string;
  help: string;
  value: boolean;
}) {
  const [on, setOn] = useState(value);
  const { save, pending } = useSetting(settingKey);

  return (
    <Row name={name} help={help}>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={name}
        disabled={pending}
        onClick={() => {
          setOn(!on);
          save(String(!on), `${name}: ${!on ? "on" : "off"}.`);
        }}
        className={cn(
          "relative h-7 w-12 cursor-pointer rounded-full transition-all disabled:opacity-50",
          on ? "bg-teal shadow-[0_0_18px_-4px_var(--teal)]" : "bg-surface-3",
        )}
      >
        <span
          className={cn(
            "absolute top-1 size-5 rounded-full bg-white transition-transform duration-200",
            on ? "translate-x-6" : "translate-x-1",
          )}
        />
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
      <span className="bg-surface-2 border-line focus-within:border-saffron inline-flex items-baseline gap-1.5 rounded-xl border px-3 py-1.5 transition-colors">
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
          className="tnum text-saffron w-[5ch] bg-transparent text-right text-[0.9375rem] font-semibold outline-none"
        />
        {unit ? <span className="text-faint text-xs">{unit}</span> : null}
      </span>
    </Row>
  );
}
