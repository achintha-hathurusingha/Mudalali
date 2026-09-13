import { log } from "../log.js";
import type { Channel } from "../channel/types.js";
import { undeliveredDecisions, claimForDelivery, releaseDelivery } from "../memory/drafts.js";
import { saveOutbound } from "../memory/repo.js";
import { confirmOrder, orderReadyToConfirm } from "../memory/orders.js";
import { getSettings } from "../memory/settings.js";

/**
 * Delivers decisions made where the sender could not reach.
 *
 * The WhatsApp command path sends the reply itself and then records it. The
 * admin console can only record - it has no WhatsApp connection. Without this
 * loop, approving a draft in the console marked the row `sent` and the customer
 * heard nothing at all.
 *
 * Rows are claimed by stamping delivered_at before sending, so a second process
 * cannot send the same reply twice; a failed send releases the claim and the
 * next pass retries.
 */
export function startOutbox(channel: Channel, everyMs = 5000): () => void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return; // a slow pass must not overlap the next one
    running = true;
    try {
      const waiting = await undeliveredDecisions();
      for (const draft of waiting) {
        const { paused } = await getSettings();
        if (paused) return; // the stop button stops this too

        if (!(await claimForDelivery(draft.id))) continue;

        try {
          await channel.send(draft.customer_jid, draft.draft_reply);
          await saveOutbound(draft.conversation_id, draft.draft_reply);
          log.info({ code: draft.id, via: "console" }, "delivered an approved reply");

          // Approving the confirmation reply is what makes the order real,
          // exactly as it does over WhatsApp - but only when it can ship.
          if (draft.order_id) {
            const missing = await orderReadyToConfirm(draft.order_id);
            if (missing.length === 0) await confirmOrder(draft.order_id);
            else log.info({ orderId: draft.order_id, missing }, "order left in draft, details missing");
          }
        } catch (error) {
          await releaseDelivery(draft.id);
          log.error({ err: error, code: draft.id }, "could not deliver an approved reply - will retry");
        }
      }
    } catch (error) {
      log.error({ err: error }, "outbox pass failed");
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), everyMs);
  void tick();
  log.info({ everyMs }, "outbox started - console approvals will be delivered");

  return () => clearInterval(timer);
}
