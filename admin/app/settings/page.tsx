import { Nav } from "@/components/nav";
import { readSettings } from "@/lib/settings";
import { asBool, asNumber, asList } from "@/lib/settings-shared";
import {
  ShopState,
  Panel,
  ModeControl,
  AutoIntentsControl,
  ToggleControl,
  NumberControl,
} from "./controls";

export const dynamic = "force-dynamic";

function changedLine(row?: { updated_at: string; updated_by: string | null }): string | undefined {
  if (!row) return undefined;
  const when = new Date(row.updated_at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Colombo",
  });
  return row.updated_by ? `${row.updated_by}, ${when}` : when;
}

export default async function SettingsPage() {
  const settings = await readSettings();

  const paused = asBool(settings.paused, false);
  const mode = settings.mode?.value ?? "suggest";
  const autoIntents = asList(settings.autoIntents);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <Nav current="/settings" />

      <div className="space-y-5">
        <ShopState paused={paused} mode={mode} autoCount={autoIntents.length} />

        <Panel title="Replying" hint={changedLine(settings.mode)} i={2}>
          <ModeControl mode={mode} />
          <AutoIntentsControl selected={autoIntents} />
        </Panel>

        <Panel title="Care" hint="what it must not decide alone" i={3}>
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
        </Panel>

        <Panel title="Timing" hint="how it listens" i={4}>
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
            help="More context costs a little more per message, and is how it knows what “eka ekak ewanna” refers to."
            value={asNumber(settings.historyTurns, 10)}
            min={2}
            max={40}
            unit="turns"
          />
        </Panel>
      </div>
    </main>
  );
}
