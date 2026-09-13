import { config } from "../config.js";
import { log } from "../log.js";
import type { Attachment, Channel, InboundMessage } from "../channel/types.js";
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
import { photosFor } from "../knowledge/photos.js";
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
  media: Attachment[];
  waMessageIds: string[];
  pushName?: string;
  phone?: string;
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

  /** Config plus whatever LIDs the channel resolved after connecting. */
  function operatorIds(): string[] {
    return channel.operatorIdentities?.() ?? config.operatorJids;
  }

  async function handle(inbound: InboundMessage): Promise<void> {
    // Replies the shop owner typed on their own phone. Record them so the model
    // does not later contradict a human who has already answered.
    if (inbound.fromMe) {
      // Single-number setup: the bot runs on the same account the drafts go to,
      // so approvals arrive in WhatsApp's "message yourself" chat as fromMe.
      if (isOperator(inbound.jid, operatorIds())) {
        await handleOperatorCommand(inbound.text, channel);
        return;
      }
      const { conversation } = await getOrCreateConversation(inbound.jid, inbound.pushName);
      await saveOutbound(conversation.id, inbound.text, inbound.waMessageId);
      log.info({ jid: inbound.jid }, "recorded a manual reply from the shop");
      return;
    }

    // The operator talks to the bot on the same channel; their messages are
    // commands and must never wait in the debounce buffer.
    if (isOperator(inbound.jid, operatorIds())) {
      await handleOperatorCommand(inbound.text, channel);
      return;
    }

    if (config.debounceMs <= 0) {
      await process(
        inbound.jid,
        [inbound.text],
        inbound.media ?? [],
        inbound.waMessageId ? [inbound.waMessageId] : [],
        inbound.pushName,
        inbound.phone,
      );
      return;
    }

    // People send one thought as three messages. Collect the burst.
    const existing = pending.get(inbound.jid);
    if (existing) {
      clearTimeout(existing.timer);
      if (inbound.text) existing.texts.push(inbound.text);
      if (inbound.media?.length) existing.media.push(...inbound.media);
      if (inbound.waMessageId) existing.waMessageIds.push(inbound.waMessageId);
      existing.pushName ??= inbound.pushName;
      existing.phone ??= inbound.phone;
      existing.timer = setTimeout(() => void fire(inbound.jid), config.debounceMs);
      return;
    }

    let resolve!: () => void;
    const settled = new Promise<void>((r) => (resolve = r));
    pending.set(inbound.jid, {
      texts: inbound.text ? [inbound.text] : [],
      media: inbound.media ?? [],
      waMessageIds: inbound.waMessageId ? [inbound.waMessageId] : [],
      pushName: inbound.pushName,
      phone: inbound.phone,
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
      await process(
        jid,
        buffered.texts,
        buffered.media,
        buffered.waMessageIds,
        buffered.pushName,
        buffered.phone,
      );
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
    media: Attachment[],
    waMessageIds: string[],
    pushName?: string,
    phone?: string,
  ): Promise<void> {
    const text = texts.join("\n").trim();
    if (!text && media.length === 0) return;

    // Anything we cannot read must reach a person, never vanish.
    const blocked = mediaProblem(media, understander.capabilities);
    if (blocked) {
      const { conversation } = await getOrCreateConversation(jid, pushName, phone);
      await recordInbound({
        conversationId: conversation.id,
        body: text || `[${media[0]?.kind ?? "media"}]`,
        waMessageId: waMessageIds[0],
      });
      log.warn({ jid, blocked }, "media could not be read");
      await channel.send(
        config.operatorJid,
        [
          `>> OVER TO YOU - ${jid.split("@")[0]}`,
          `${blocked} - open WhatsApp and look at it yourself.`,
          text ? `\n> ${text}` : "",
          `\nReply through the bot:  msg ${jid.split("@")[0]} <your text>`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      return;
    }

    const { customer, conversation } = await getOrCreateConversation(jid, pushName, phone);

    // Written before the model runs: a crash mid-call must not lose a customer,
    // and a WhatsApp redelivery must not be answered twice.
    const mediaKind = media[0]?.kind ?? null;
    const placeholder = mediaKind === "audio" ? "[voice note]" : mediaKind === "image" ? "[photo]" : "";
    const messageId = await recordInbound({
      conversationId: conversation.id,
      body: text || placeholder,
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
      result = await understander.understand({ history, message: text, media, products });
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
    // The bytes are not kept. What the model read becomes the stored turn, so
    // every later turn sees the photo or voice note as ordinary history - and
    // so you read the transcript, not "[voice note]", in the draft.
    const storedBody = mediaKind && u.mediaSummary ? asStoredBody(mediaKind, u.mediaSummary, text) : null;
    await annotateInbound({
      messageId,
      understanding: u,
      model: result.model,
      latencyMs: result.latencyMs,
      mediaKind,
      body: storedBody ?? undefined,
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

    // Photos the customer asked to see. Sent regardless of mode: showing a
    // product is not a claim that needs approval, and "photo ewanna" going
    // unanswered is what loses the sale.
    const sentPhotos = await sendRequestedPhotos(jid, u, conversation.id);

    const decision = decide(u);
    log.info(
      { jid, intent: u.intent, confidence: u.confidence, action: decision.action, ms: result.latencyMs },
      "handled",
    );

    // A misread photo is a worse failure than a misread sentence, so anything
    // carrying media waits for a person even when the intent is an auto one.
    const holdForMedia = media.length > 0 && !config.autoReplyMedia;

    if (decision.action === "auto_reply") {
      if (!holdForMedia) {
        await channel.send(jid, decision.reply);
        await saveOutbound(conversation.id, decision.reply);
        return;
      }
      log.info({ jid, kind: mediaKind }, "media reply held for approval");
      const held = await createDraft({
        conversationId: conversation.id,
        customerJid: jid,
        incomingBody: storedBody ?? text,
        draftReply: decision.reply,
        intent: u.intent,
        orderId,
      });
      await channel.send(
        config.operatorJid,
        renderDraftForOperator({
          code: held.id,
          customerJid: jid,
          customerPhone: customer.phone,
          customerName: customer.name,
          incoming: storedBody ?? text,
          intent: u.intent,
          confidence: u.confidence,
          reason: `${mediaKind === "audio" ? "voice note" : "photo"} - held for approval`,
          draft: decision.reply,
          orderSummary,
          orderId,
        }),
      );
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
          customerPhone: customer.phone,
          customerName: customer.name,
          incoming: storedBody ?? text,
          intent: u.intent,
          reason: decision.reason,
          acknowledged: config.autoAckEscalations ? decision.holdingReply : null,
          orderSummary,
        }),
      );
      return;
    }

    const mediaNote = mediaKind === "audio" ? "voice note" : mediaKind === "image" ? "photo" : null;
    const draft = await createDraft({
      conversationId: conversation.id,
      customerJid: jid,
      incomingBody: storedBody ?? text,
      draftReply: decision.reply,
      intent: u.intent,
      orderId,
    });

    await channel.send(
      config.operatorJid,
      renderDraftForOperator({
        code: draft.id,
        customerJid: jid,
        customerPhone: customer.phone,
        customerName: customer.name,
        incoming: storedBody ?? text,
        intent: u.intent,
        confidence: u.confidence,
        reason: mediaNote ? `${mediaNote} - ${decision.reason}` : decision.reason,
        draft: decision.reply,
        orderSummary,
        orderId,
      }),
    );
  }

  /** Returns how many photos actually went out. */
  async function sendRequestedPhotos(
    jid: string,
    u: { sendPhotos: Array<{ productId: string; colour: string | null }> },
    conversationId: number,
  ): Promise<number> {
    if (u.sendPhotos.length === 0) return 0;
    if (!channel.sendImage) {
      log.warn({ channel: channel.name }, "photos requested but this channel cannot send them");
      return 0;
    }

    let sent = 0;
    const seen = new Set<string>();
    for (const request of u.sendPhotos) {
      for (const photo of photosFor(request.productId, request.colour)) {
        if (seen.has(photo.path)) continue;
        seen.add(photo.path);
        try {
          await channel.sendImage(jid, photo.path, photo.colour);
          sent++;
        } catch (error) {
          log.error({ err: error, photo: photo.path }, "could not send a product photo");
        }
      }
    }

    if (sent > 0) {
      await saveOutbound(conversationId, `[sent ${sent} product photo${sent === 1 ? "" : "s"}]`);
      log.info({ jid, sent }, "sent product photos");
    } else {
      log.warn({ jid, requested: u.sendPhotos }, "photos were requested but none were found");
    }
    return sent;
  }

  return { handle, flush };
}

/** Describes why media cannot be processed, or null when it can. */
function mediaProblem(media: Attachment[], can: { image: boolean; audio: boolean }): string | null {
  for (const m of media) {
    if (m.data.length > config.maxMediaBytes) {
      return `a ${m.kind === "audio" ? "voice note" : "photo"} too large to read (${Math.round(m.data.length / 1024)} KB)`;
    }
    if (m.kind === "audio" && !can.audio) return "a voice note, which this model cannot listen to";
    if (m.kind === "image" && !can.image) return "a photo, which this model cannot see";
  }
  return null;
}

/** What gets written to the messages table in place of the bytes. */
function asStoredBody(kind: "image" | "audio", summary: string, caption: string): string {
  // A voice note IS the message, so the transcript stands alone.
  if (kind === "audio") return caption ? `${summary}
${caption}` : summary;
  return caption ? `[photo: ${summary}]
${caption}` : `[photo: ${summary}]`;
}
