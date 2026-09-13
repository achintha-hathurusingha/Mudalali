import { Nav } from "@/components/nav";
import { readSettings } from "@/lib/settings";
import { asBool, asNumber, asList } from "@/lib/settings-shared";
import { ShopState, ModeControl, AutoIntentsControl, ToggleControl, NumberControl } from "./controls";

export const dynamic = "force-dynamic";

/** Section names sit in the margin beside their rows, the way a ledger is annotated. */
function Section({
  name,
  note,
  children,
}: {
  name: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10 grid gap-x-10 gap-y-2 sm:grid-cols-[9rem_1fr]">
      <div className="sm:pt-4">
        <h2 className="font-display text-xl leading-none">{name}</h2>
        {note ? <p className="text-ink-faint mt-1.5 text-xs leading-snug">{note}</p> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

function changedLine(row?: { updated_at: string; updated_by: string | null }): string | null {
  if (!row) return null;
  const when = new Date(row.updated_at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return row.updated_by ? `${row.updated_by}, ${when}` : when;
}

export default async function SettingsPage() {
  const settings = await readSettings();

  const paused = asBool(settings.paused, false);
  const mode = settings.mode?.value ?? "suggest";
  const autoIntents = asList(settings.autoIntents);
  const lastTouched = changedLine(settings.mode);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10 sm:px-8">
      <Nav current="/settings" />

      <ShopState paused={paused} mode={mode} autoCount={autoIntents.length} />

      <Section name="Replying" note={lastTouched ? `Last touched ${lastTouched}` : undefined}>
        <ModeControl mode={mode} />
        <AutoIntentsControl selected={autoIntents} />
      </Section>

      <Section name="Care" note="What it must not decide alone">
        <NumberControl
          settingKey="minConfidence"
          name="How sure before it replies alone"
          help="Under this, the reply waits for you even in Auto. Between 0 and 1."
          value={asNumber(settings.minConfidence, 0.8)}
          step={0.05}
          min={0}
          max={1}
        />
        <ToggleControl
          settingKey="autoReplyMedia"
          name="Answer photos on its own"
          help="A misread photo is a worse mistake than a misread sentence. Leave this off until you have watched it work."
          value={asBool(settings.autoReplyMedia, false)}
        />
        <ToggleControl
          settingKey="autoAckEscalations"
          name="Say something when it hands over"
          help="Sends a short holding line the moment a message comes to you, so nobody sits in silence."
          value={asBool(settings.autoAckEscalations, true)}
        />
      </Section>

      <Section name="Timing" note="How it listens">
        <NumberControl
          settingKey="debounceMs"
          name="Wait for someone still typing"
          help="People send one thought as three messages. Waiting gathers them into one reply."
          value={asNumber(settings.debounceMs, 5000)}
          step={500}
          min={0}
          unit="ms"
        />
        <NumberControl
          settingKey="historyTurns"
          name="How much it remembers"
          help="More context costs a little more per message, and is how it knows what &ldquo;eka ekak ewanna&rdquo; refers to."
          value={asNumber(settings.historyTurns, 10)}
          min={2}
          max={40}
          unit="turns"
        />
      </Section>
    </main>
  );
}
