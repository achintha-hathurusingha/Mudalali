import { Nav } from "@/components/nav";
import { readSettings } from "@/lib/settings";
import { asBool, asNumber, asList } from "@/lib/settings-shared";
import { Separator } from "@/components/ui/separator";
import {
  PauseControl,
  ModeControl,
  AutoIntentsControl,
  ToggleControl,
  NumberControl,
} from "./controls";

export const dynamic = "force-dynamic";

function lastChanged(row?: { updated_at: string; updated_by: string | null }): string | null {
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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Nav current="/settings" />

      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Agent controls</h1>
        <p className="text-muted-foreground text-sm">
          Changes reach the running agent within a few seconds. Nothing restarts.
        </p>
      </div>

      <div className="space-y-8">
        <PauseControl paused={paused} />

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Reply mode</h2>
            <p className="text-muted-foreground text-sm">
              {lastChanged(settings.mode) ? `Last changed by ${lastChanged(settings.mode)}` : "Never changed"}
            </p>
          </div>
          <ModeControl mode={mode} />
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-medium">Which messages may answer themselves</h2>
            <p className="text-muted-foreground text-sm">
              Only applies in Auto mode. Bargaining, complaints and order status always reach you —
              those are relationship moments, not classification problems.
            </p>
          </div>
          <AutoIntentsControl selected={asList(settings.autoIntents)} />
        </section>

        <Separator />

        <section>
          <h2 className="mb-1 text-sm font-medium">Safety</h2>
          <div className="divide-y">
            <NumberControl
              settingKey="minConfidence"
              label="Confidence needed to reply alone"
              help="Below this, the reply waits for you even in Auto mode. 0 to 1."
              value={asNumber(settings.minConfidence, 0.8)}
              step={0.05}
              min={0}
              max={1}
            />
            <ToggleControl
              settingKey="autoReplyMedia"
              label="Answer photos without me"
              help="A misread photo is a worse mistake than a misread sentence. Leave off until you have watched it work."
              value={asBool(settings.autoReplyMedia, false)}
            />
            <ToggleControl
              settingKey="autoAckEscalations"
              label="Tell customers straight away when I need to step in"
              help="Sends a short holding line the moment something is handed to you, instead of leaving them in silence."
              value={asBool(settings.autoAckEscalations, true)}
            />
          </div>
        </section>

        <Separator />

        <section>
          <h2 className="mb-1 text-sm font-medium">Timing</h2>
          <div className="divide-y">
            <NumberControl
              settingKey="debounceMs"
              label="Wait for someone still typing"
              help="People send one thought as three messages. Waiting groups them into one reply."
              value={asNumber(settings.debounceMs, 5000)}
              step={500}
              min={0}
              suffix="ms"
            />
            <NumberControl
              settingKey="historyTurns"
              label="How much of the conversation the AI sees"
              help="More context costs more per message but resolves 'eka ekak ewanna' better."
              value={asNumber(settings.historyTurns, 10)}
              min={2}
              max={40}
              suffix="turns"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
