import { Nav } from "@/components/nav";
import { listPendingDrafts, readEditRates } from "@/lib/approvals";
import { EditRateHero, EmptyQueue, Queue } from "./queue";

export const dynamic = "force-dynamic";

/**
 * Approvals. The edit rate leads, because it is the number that tells the owner
 * where the prompt is wrong; the queue follows, oldest first, and every card is
 * a decision recorded here for the agent to deliver.
 */
export default async function ApprovalsPage() {
  const [drafts, rates] = await Promise.all([listPendingDrafts(), readEditRates()]);
  const resolved = rates.reduce((total, row) => total + row.sent + row.edited + row.skipped, 0);

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
      <Nav current="/approvals" />

      <div className="space-y-5">
        <EditRateHero rates={rates} waiting={drafts.length} />

        {drafts.length === 0 ? <EmptyQueue resolved={resolved} /> : <Queue drafts={drafts} />}
      </div>
    </main>
  );
}
