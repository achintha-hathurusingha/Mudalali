import { Nav } from "@/components/nav";
import { Separator } from "@/components/ui/separator";
import { listPendingDrafts, readEditRates } from "@/lib/approvals";
import { Queue, type EditRate } from "./queue";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : Math.round((part / whole) * 100);
}

function intentLabel(intent: string): string {
  return intent.replace(/_/g, " ");
}

/**
 * The edit rate, by intent. Of the drafts the owner let through, how many did
 * they have to rewrite first - the one number that says where the prompt is
 * wrong. Skips are counted separately: a skip is usually a conversation that
 * moved on, not a bad draft.
 */
function EditRateSummary({ rates }: { rates: EditRate[] }) {
  const sent = rates.reduce((total, row) => total + row.sent, 0);
  const edited = rates.reduce((total, row) => total + row.edited, 0);
  const skipped = rates.reduce((total, row) => total + row.skipped, 0);
  const approved = sent + edited;

  if (approved === 0) {
    return (
      <section className="space-y-1">
        <h2 className="text-sm font-medium">Edit rate</h2>
        <p className="text-muted-foreground text-sm">
          Nothing approved yet. Once you have let a few drafts through, this shows how often you had
          to rewrite one first - broken down by intent, so you can see which part of the prompt is
          wrong.
        </p>
      </section>
    );
  }

  const shown = rates.filter((row) => row.sent + row.edited > 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">Edit rate</h2>
        <p className="text-muted-foreground text-sm">
          <span className="text-foreground font-medium tabular-nums">
            {percent(edited, approved)}%
          </span>{" "}
          — you rewrote {edited} of the {approved} drafts you let through.
        </p>
      </div>

      <ul className="divide-y">
        {shown.map((row) => {
          const total = row.sent + row.edited;
          const rate = percent(row.edited, total);
          return (
            <li key={row.intent} className="flex items-center gap-3 py-1.5 text-sm">
              <span className="w-24 shrink-0 truncate sm:w-32">{intentLabel(row.intent)}</span>
              <span className="text-muted-foreground hidden w-28 shrink-0 text-xs tabular-nums sm:inline">
                {row.edited} of {total} rewritten
              </span>
              <span className="bg-muted h-1.5 min-w-0 flex-1 overflow-hidden rounded-full">
                <span className="bg-foreground block h-1.5 rounded-full" style={{ width: `${rate}%` }} />
              </span>
              <span
                className={cn(
                  "w-10 shrink-0 text-right text-xs tabular-nums",
                  rate >= 50 && "text-destructive",
                )}
              >
                {rate}%
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-muted-foreground text-xs">
        A row above half means the agent is usually wrong about that intent - the prompt needs
        changing, not your patience.
        {skipped > 0 ? ` ${skipped} skipped draft${skipped === 1 ? "" : "s"} not counted.` : ""}
      </p>
    </section>
  );
}

function EmptyQueue({ resolved }: { resolved: number }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <p className="text-sm font-medium">Nothing waiting for you.</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
        A draft appears here within seconds of a customer writing in, whenever the agent wants your
        approval before it replies.
        {resolved > 0
          ? ` ${resolved} draft${resolved === 1 ? " has" : "s have"} come through here so far.`
          : ""}
      </p>
      <p className="text-muted-foreground mt-3 text-xs">
        This page is read fresh each time you open it. Reload to check for new drafts.
      </p>
    </div>
  );
}

export default async function ApprovalsPage() {
  const [drafts, rates] = await Promise.all([listPendingDrafts(), readEditRates()]);
  const resolved = rates.reduce((total, row) => total + row.sent + row.edited + row.skipped, 0);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <Nav current="/approvals" />

      <div className="mb-8">
        <h1 className="text-xl font-semibold tracking-tight">Approvals</h1>
        <p className="text-muted-foreground text-sm">
          Approve, rewrite or skip what the agent wants to say. Your decision is recorded here; the
          agent delivers the message.
        </p>
      </div>

      <div className="space-y-8">
        <EditRateSummary rates={rates} />

        <Separator />

        {drafts.length === 0 ? <EmptyQueue resolved={resolved} /> : <Queue drafts={drafts} />}
      </div>
    </main>
  );
}
