"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateSetting } from "@/app/actions";
import { INTENTS, NEVER_AUTOMATED, type SettingKey } from "@/lib/settings-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function useSetting(key: SettingKey) {
  const [pending, start] = useTransition();
  const save = (value: string, describe: (v: string) => string) =>
    start(async () => {
      try {
        await updateSetting(key, value);
        toast.success(describe(value), { description: "The agent picks this up within a few seconds." });
      } catch {
        toast.error("Could not save that.", { description: "Nothing changed - try again." });
      }
    });
  return { save, pending };
}

/** The stop button. Deliberately the loudest thing on the page. */
export function PauseControl({ paused }: { paused: boolean }) {
  const [on, setOn] = useState(paused);
  const { save, pending } = useSetting("paused");

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-6 rounded-lg border p-4",
        on && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="space-y-1">
        <p className="font-medium">{on ? "Paused — nobody is being answered" : "Answering customers"}</p>
        <p className="text-muted-foreground text-sm">
          {on
            ? "Messages are still being recorded, so nothing is lost. Turn this back on when you are ready."
            : "Turn this off to stop every reply immediately, without stopping the agent."}
        </p>
      </div>
      <Switch
        checked={!on}
        disabled={pending}
        onCheckedChange={(checked) => {
          setOn(!checked);
          save(String(!checked), (v) => (v === "true" ? "Paused. Nothing will be sent." : "Answering again."));
        }}
        aria-label="Answering customers"
      />
    </div>
  );
}

export function ModeControl({ mode }: { mode: string }) {
  const [value, setValue] = useState(mode);
  const { save, pending } = useSetting("mode");

  const options = [
    {
      id: "suggest",
      title: "Suggest",
      body: "Every reply waits for you to approve it. Start here.",
    },
    {
      id: "auto",
      title: "Auto",
      body: "Safe replies send themselves. Orders and complaints still wait for you.",
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={pending}
          onClick={() => {
            setValue(option.id);
            save(option.id, () => `Reply mode: ${option.title}.`);
          }}
          className={cn(
            "rounded-lg border p-4 text-left transition-colors",
            value === option.id ? "border-foreground bg-accent" : "hover:bg-accent/50",
          )}
        >
          <p className="font-medium">{option.title}</p>
          <p className="text-muted-foreground mt-1 text-sm">{option.body}</p>
        </button>
      ))}
    </div>
  );
}

export function AutoIntentsControl({ selected }: { selected: string[] }) {
  const [value, setValue] = useState(selected);
  const { save, pending } = useSetting("autoIntents");

  const toggle = (intent: string) => {
    const next = value.includes(intent) ? value.filter((i) => i !== intent) : [...value, intent];
    setValue(next);
    save(next.join(","), () => `${intent.replace("_", " ")} ${next.includes(intent) ? "can" : "cannot"} self-answer.`);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {INTENTS.map((intent) => {
        const locked = (NEVER_AUTOMATED as readonly string[]).includes(intent);
        const on = value.includes(intent) && !locked;
        return (
          <button
            key={intent}
            type="button"
            disabled={locked || pending}
            onClick={() => toggle(intent)}
            title={locked ? "Always handled by a person - this cannot be changed" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              locked && "text-muted-foreground cursor-not-allowed line-through opacity-60",
              !locked && on && "border-foreground bg-foreground text-background",
              !locked && !on && "hover:bg-accent",
            )}
          >
            {intent.replace("_", " ")}
          </button>
        );
      })}
    </div>
  );
}

export function ToggleControl({
  settingKey,
  label,
  help,
  value,
}: {
  settingKey: SettingKey;
  label: string;
  help: string;
  value: boolean;
}) {
  const [on, setOn] = useState(value);
  const { save, pending } = useSetting(settingKey);

  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-sm">{help}</p>
      </div>
      <Switch
        checked={on}
        disabled={pending}
        onCheckedChange={(checked) => {
          setOn(checked);
          save(String(checked), () => `${label}: ${checked ? "on" : "off"}.`);
        }}
        aria-label={label}
      />
    </div>
  );
}

export function NumberControl({
  settingKey,
  label,
  help,
  value,
  step = 1,
  min,
  max,
  suffix,
}: {
  settingKey: SettingKey;
  label: string;
  help: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const { save, pending } = useSetting(settingKey);

  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === "") {
      setDraft(String(value));
      toast.error("That is not a number.", { description: "Left it as it was." });
      return;
    }
    if (n === value) return;
    save(String(n), () => `${label}: ${n}${suffix ? ` ${suffix}` : ""}.`);
  };

  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <div className="space-y-1">
        <Label htmlFor={settingKey} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-muted-foreground text-sm">{help}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          id={settingKey}
          type="number"
          inputMode="decimal"
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
          className="w-28"
        />
        {suffix ? <span className="text-muted-foreground text-sm">{suffix}</span> : null}
      </div>
    </div>
  );
}

export function SignOutButton({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <Button type="submit" variant="ghost" size="sm">
        Sign out
      </Button>
    </form>
  );
}
