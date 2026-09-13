import { config } from "../config.js";
import { log } from "../log.js";
import type { Channel, InboundMessage } from "../channel/types.js";
import type { Understander } from "../understanding/types.js";
import { loadCatalog } from "../knowledge/catalog.js";
import { isOperator } from "../util/jid.js";
import {
  getOrCreateConversation,
  recentTurns,
  recordInbound,
  annotateInbound,
  saveOutbound,
  rememberCustomerDetails,
} from "../memory/repo.js";
import { createDraftOrder, renderOrder, renderProblems } from "../memory/orders.js";
import { createDraft } from "../memory/drafts.js";
import { decide } from "./policy.js";
import { handleOperatorCommand, renderDraftForOperator, renderHandover } from "../human/operator.js";

export type Pipeline = {
  handle: (message: InboundMessage) => Promise<void>;
  /** Process anything still sitting in the debounce window. */
  flush: () => Promise<void>;
};

type Pending = {
  texts: string[];
  waMessageIds: string[];
  pushName?: string;
  timer: NodeJS.Timeout;
  settled: Promise<void>;
  resolve: () => void;
};

/**
 * Channel -> Understanding -> Memory -> Knowledge -> Action -> Human.
 * The unit of processing is the conversation, never the lone message.
 */
export function createPipeline(channel: Channel, understander: Understander): Pipeline {
  const pending = new Map<string, Pending>();

  async function handle(inbound: InboundMessage): Promise<void> {
    // Replies the shop owner typed on their own phone. Record them so the model
    // does not later contradict a human who has already answered.
    if (inbound.fromMe) {
      if (isOperator(inbound.jid, config.operatorJids)) return;
      const { conversation } = await getOrCreateConversation(inbound.jid, inbound.pushName);
      await saveOutbound(conversation.id, inbound.text, inbound.waMessageId);
      log.info({ jid: inbound.jid }, "recorded a manual reply from the shop");
      return;
    }

    // The operator talks to the bot on the same channel; their messages are
    // commands and must never wait in the debounce buffer.
    if (isOperator(inbound.jid, config.operatorJids)) {
      await handleOperatorCommand(inbound.text, channel);
      return;
    }

    if (config.debounceMs <= 0) {
      await process(inbound.jid, [inbound.text], inbound.waMessageId ? [inbound.waMessageId] : [], inbound.pushName);
      return;
    }

    // People send one thought as three messages. Collect the burst.
    const existing = pending.get(inbound.jid);
    if (existing) {
      clearTimeout(existing.timer);
      existing.texts.push(inbound.text);
      if (inbound.waMessageId) existing.waMessageIds.push(inbound.waMessageId);
      existing.pushName ??= inbound.pushName;
      existing.timer = setTimeout(() => void fire(inbound.jid), config.debounceMs);
      return;
    }

    let resolve!: () => void;
    const settled = new Promise<void>((r) => (resolve = r));
    pending.set(inbound.jid, {
      texts: [inbound.text],
      waMessageIds: inbound.waMessageId ? [inbound.waMessageId] : [],
      pushName: inbound.pushName,
      timer: setTimeout(() => void fire(inbound.jid), config.debounceMs),
      settled,
      resolve,
    });
  }

  async function fire(jid: string): Promise<void> {
    const buffered = pending.get(jid);
    if (!buffered) return;
    pending.delete(jid);
    clearTimeout(buffered.timer);
    try {
      await process(jid, buffered.texts, buffered.waMessageIds, buffered.pushName);
    } finally {
      buffered.resolve();
    }
  }

  async function flush(): Promise<void> {
    const waiting = [...pending.keys()].map((jid) => {
      const settled = pending.get(jid)!.settled;
      void fire(jid);
      return settled;
    });
    await Promise.all(waiting);
  }

  async function process(
    jid: string,
    texts: string[],
    waMessageIds: string[],
    pushName?: string,
  ): Promise<void> {
    const text = texts.join("\n").trim();
    if (!text) return;

    const { customer, conversation } = await getOrCreateConversation(jid, pushName);

    // Written before the model runs: a crash mid-call must not lose a customer,
    // and a WhatsApp redelivery must not be answered twice.
    const messageId = await recordInbound({
      conversationId: conversation.id,
      body: text,
      waMessageId: waMessageIds[0],
    });
    if (messageId === null) {
      log.debug({ jid, waMessageIds }, "duplicate delivery ignored");
      return;
    }

    const [history, products] = await Promise.all([
      recentTurns(conversation.id).then((turns) => turns.slice(0, -1)),
      loadCatalog(),
    ]);

    let result;
    try {
      result = await understander.understand({ history, message: text, products });
    } catch (error) {
      // A model failure must never swallow a customer. Log it and hand to a human.
      log.error({ err: error, jid }, "understanding failed");
      await channel.send(
        config.operatorJid,
        `Could not read this message, please reply yourself:\n${jid.split("@")[0]}\n> ${text}`,
      );
      return;
    }

    const u = result.understanding;
    await annotateInbound({
      messageId,
      understanding: u,
      model: result.model,
      latencyMs: result.latencyMs,
    });
    await rememberCustomerDetails(customer, {
      customerName: u.entities.customerName,
      city: u.entities.city,
    });

    // A ready order becomes a draft row now, so the operator confirms a real
    // record - and anything the catalog cannot honour is refused here.
    let orderSummary: string | undefined;
    let orderId: number | null = null;
    if (u.intent === "place_order" && u.orderReady) {
      const outcome = await createDraftOrder({
        customerId: customer.id,
        conversationId: conversation.id,
        understanding: u,
      });
      if (outcome?.ok) {
        orderSummary = renderOrder(outcome.order);
        orderId = outcome.order.id;
      } else if (outcome) {
        orderSummary = renderProblems(outcome.problems);
      }
    }

    const decision = decide(u);
    log.info(
      { jid, intent: u.intent, confidence: u.confidence, action: decision.action, ms: result.latencyMs },
      "handled",
    );

    if (decision.action === "auto_reply") {
      await channel.send(jid, decision.reply);
      await saveOutbound(conversation.id, decision.reply);
      return;
    }

    // Escalation: the customer hears something immediately, then a human takes
    // over. Silence until the operator wakes up is how trust is lost.
    if (decision.action === "escalate") {
      if (config.autoAckEscalations) {
        await channel.send(jid, decision.holdingReply);
        await saveOutbound(conversation.id, decision.holdingReply);
      }
      await channel.send(
        config.operatorJid,
        renderHandover({
          customerJid: jid,
          customerName: customer.name,
          incoming: text,
          intent: u.intent,
          reason: decision.reason,
          acknowledged: config.autoAckEscalations ? decision.holdingReply : null,
          orderSummary,
        }),
      );
      return;
    }

    const draft = await createDraft({
      conversationId: conversation.id,
      customerJid: jid,
      incomingBody: text,
      draftReply: decision.reply,
      intent: u.intent,
      orderId,
    });

    await channel.send(
      config.operatorJid,
      renderDraftForOperator({
        code: draft.id,
        customerJid: jid,
        customerName: customer.name,
        incoming: text,
        intent: u.intent,
        confidence: u.confidence,
        reason: decision.reason,
        draft: decision.reply,
        orderSummary,
        orderId,
      }),
    );
  }

  return { handle, flush };
}
