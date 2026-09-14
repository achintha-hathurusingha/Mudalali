import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { Channel } from "../channel/types.js";
import { config } from "../config.js";
import { getPendingDraft, resolveDraft, listPendingDrafts } from "../memory/drafts.js";
import { saveOutbound, findCustomerByPhone, openConversationFor } from "../memory/repo.js";
import { confirmOrder, cancelOrder, orderReadyToConfirm } from "../memory/orders.js";
import { phoneOf } from "../util/jid.js";
import { log } from "../log.js";

/**
 * The approval loop runs over WhatsApp itself - no dashboard to build,
 * no second app for the shop owner to remember to open.
 */
export function renderDraftForOperator(args: {
  code: string;
  customerJid: string;
  customerPhone?: string | null;
  customerName: string | null;
  incoming: string;
  intent: string;
  confidence: number;
  reason: string | null;
  draft: string;
  orderSummary?: string;
  orderId?: number | null;
}): string {
  // A @lid is an opaque id, so show the real number when we have it.
  const shown = args.customerPhone ?? phoneOf(args.customerJid);
  const who = args.customerName ? `${args.customerName} (${shown})` : shown;
  const lines = [
    `[${args.code}] ${who}`,
    `${args.intent} ${args.confidence.toFixed(2)}${args.reason ? ` - ${args.reason}` : ""}`,
    "",
    `> ${args.incoming}`,
    "",
    `Draft: ${args.draft}`,
  ];
  if (args.orderSummary) lines.push("", args.orderSummary);
  lines.push("", `ok ${args.code}  |  ${args.code} <your text>  |  skip ${args.code}`);
  if (args.orderId) lines.push(`ok also confirms order #${args.orderId}`);
  return lines.join("\n");
}

/** Something a person has to take over. The customer has already been answered. */
export function renderHandover(args: {
  customerJid: string;
  customerPhone?: string | null;
  customerName: string | null;
  incoming: string;
  intent: string;
  reason: string;
  acknowledged: string | null;
  orderSummary?: string;
}): string {
  const phone = args.customerPhone ?? phoneOf(args.customerJid);
  const who = args.customerName ? `${args.customerName} (${phone})` : phone;
  const lines = [`>> OVER TO YOU - ${who}`, `${args.intent} - ${args.reason}`, "", `> ${args.incoming}`];
  if (args.acknowledged) lines.push("", `Already sent: ${args.acknowledged}`);
  else lines.push("", "Nothing sent to the customer yet.");
  if (args.orderSummary) lines.push("", args.orderSummary);
  lines.push("", `Reply through the bot:  msg ${phone} <your text>`);
  return lines.join("\n");
}

const HELP = [
  "Commands:",
  "  ok <code>            send the draft as written",
  "  <code> <your text>   send your version instead",
  "  skip <code>          send nothing",
  "  pending              list drafts still waiting",
  "  msg <phone> <text>   message a customer through the bot",
  "  file <phone|jid> <path> [| caption]   send a PDF or other file through the bot",
  "  confirm <order id>   mark a draft order confirmed",
  "  cancel <order id>    cancel a draft order",
].join("\n");

/**
 * An operator addresses someone by phone or by raw JID. Phone is preferred - it
 * finds the conversation, so the send is recorded against it - but on Baileys 7
 * a customer arrives as an @lid whose real number is often never learned, and
 * those can only be reached by the JID itself.
 */
async function resolveRecipient(
  target: string,
): Promise<{ jid: string; customerId?: number } | null> {
  if (target.includes("@")) {
    // findCustomerByPhone also matches on the JID prefix, so the local part
    // finds an @lid customer whose real number was never learned. Without this
    // a file sent by JID would go out unrecorded.
    const local = target.split("@")[0]!.split(":")[0]!;
    const byJid = await findCustomerByPhone(local);
    return { jid: target, customerId: byJid?.id };
  }

  const digits = target.replace(/\D/g, "");
  if (digits.length < 7) return null;

  const customer = await findCustomerByPhone(digits);
  if (customer) return { jid: customer.wa_jid, customerId: customer.id };
  return { jid: `${digits}@s.whatsapp.net` };
}

/**
 * Returns true when the message was an operator command (and was handled).
 */
export async function handleOperatorCommand(text: string, channel: Channel): Promise<boolean> {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower === "help" || lower === "?") {
    await channel.send(config.operatorJid, HELP);
    return true;
  }

  if (lower === "pending") {
    const pending = await listPendingDrafts();
    const body = pending.length
      ? pending.map((d) => `[${d.id}] ${d.intent ?? "?"} - ${d.incoming_body.slice(0, 60)}`).join("\n")
      : "Nothing waiting.";
    await channel.send(config.operatorJid, body);
    return true;
  }

  const orderMatch = /^(confirm|cancel)\s+#?(\d+)$/i.exec(trimmed);
  if (orderMatch) {
    const action = orderMatch[1]!.toLowerCase();
    const orderId = Number(orderMatch[2]!);
    if (action === "cancel") {
      await cancelOrder(orderId);
      await channel.send(config.operatorJid, `Order #${orderId} cancelled.`);
      return true;
    }
    const missing = await orderReadyToConfirm(orderId);
    if (missing.length > 0) {
      await channel.send(config.operatorJid, `Order #${orderId} still needs ${missing.join(", ")}.`);
      return true;
    }
    await confirmOrder(orderId);
    await channel.send(config.operatorJid, `Order #${orderId} confirmed.`);
    return true;
  }

  // msg 94771234567 Hi, your order is on the way
  const msgMatch = /^msg\s+(\+?\d{7,15})\s+([\s\S]+)$/i.exec(trimmed);
  if (msgMatch) {
    const phone = msgMatch[1]!.replace(/\D/g, "");
    const body = msgMatch[2]!.trim();
    const customer = await findCustomerByPhone(phone);
    if (!customer) {
      await channel.send(config.operatorJid, `No conversation with ${phone}.`);
      return true;
    }
    await channel.send(customer.wa_jid, body);
    const conversation = await openConversationFor(customer.id);
    if (conversation) await saveOutbound(conversation.id, body);
    await channel.send(config.operatorJid, `Sent to ${phone}.`);
    return true;
  }

  // file 94771234567 C:\invoices\order-41.pdf | Your invoice
  // file 208151848742972@lid ./report.pdf
  const fileMatch = /^(?:file|pdf|doc)\s+(\S+)\s+([\s\S]+)$/i.exec(trimmed);
  if (fileMatch) {
    const target = fileMatch[1]!;
    // The path may contain spaces, so the caption is split off on a pipe
    // rather than by guessing where the filename ends.
    const [rawPath, ...captionParts] = fileMatch[2]!.split("|");
    const filePath = rawPath!.trim();
    const caption = captionParts.join("|").trim() || undefined;

    if (!channel.sendDocument) {
      await channel.send(config.operatorJid, `${channel.name} cannot send files.`);
      return true;
    }
    if (!existsSync(filePath)) {
      await channel.send(config.operatorJid, `No file at ${filePath}.`);
      return true;
    }

    const recipient = await resolveRecipient(target);
    if (!recipient) {
      await channel.send(config.operatorJid, `Could not work out who ${target} is.`);
      return true;
    }

    const name = basename(filePath);
    try {
      await channel.sendDocument(recipient.jid, filePath, name, caption);
    } catch (error) {
      await channel.send(
        config.operatorJid,
        `Could not send ${name}: ${(error as Error).message}`,
      );
      return true;
    }

    // Recorded so the conversation history shows the file went out, the same
    // way a photo send is recorded.
    if (recipient.customerId) {
      const conversation = await openConversationFor(recipient.customerId);
      const note = `[sent file ${name}]${caption ? ` ${caption}` : ""}`;
      if (conversation) await saveOutbound(conversation.id, note);
    }

    log.info({ to: recipient.jid, file: name }, "operator sent a file");
    await channel.send(config.operatorJid, `Sent ${name} to ${target}.`);
    return true;
  }

  const okMatch = /^ok\s+([a-z0-9]{4})$/i.exec(trimmed);
  if (okMatch) {
    const code = okMatch[1]!;
    const draft = await getPendingDraft(code);
    if (!draft) {
      await channel.send(config.operatorJid, `No pending draft ${code}.`);
      return true;
    }
    try {
      await channel.send(draft.customer_jid, draft.draft_reply);
    } catch (error) {
      // Leave the draft pending so it can simply be approved again.
      log.error({ err: error, code }, "could not send an approved draft");
      await channel.send(
        config.operatorJid,
        `Could not send ${code}: ${(error as Error).message}. It is still pending - try "ok ${code}" again.`,
      );
      return true;
    }
    await saveOutbound(draft.conversation_id, draft.draft_reply);
    await resolveDraft(code, "sent", true);

    // Approving the confirmation reply is what makes the order real - but only
    // when there is somewhere to ship it to.
    if (draft.order_id) {
      const missing = await orderReadyToConfirm(draft.order_id);
      if (missing.length === 0) {
        await confirmOrder(draft.order_id);
        await channel.send(config.operatorJid, `Sent ${code}. Order #${draft.order_id} confirmed.`);
      } else {
        await channel.send(
          config.operatorJid,
          `Sent ${code}. Order #${draft.order_id} still needs ${missing.join(", ")} - ` +
            `send "confirm ${draft.order_id}" once you have it.`,
        );
      }
    } else {
      await channel.send(config.operatorJid, `Sent ${code}.`);
    }
    log.info({ code, orderId: draft.order_id }, "operator approved draft");
    return true;
  }

  const skipMatch = /^skip\s+([a-z0-9]{4})$/i.exec(trimmed);
  if (skipMatch) {
    const code = skipMatch[1]!;
    const draft = await getPendingDraft(code);
    if (!draft) {
      await channel.send(config.operatorJid, `No pending draft ${code}.`);
      return true;
    }
    await resolveDraft(code, "skipped");
    if (draft.order_id) await cancelOrder(draft.order_id);
    await channel.send(config.operatorJid, `Skipped ${code}.`);
    return true;
  }

  const editMatch = /^([a-z0-9]{4})\s+([\s\S]+)$/i.exec(trimmed);
  if (editMatch) {
    const code = editMatch[1]!;
    const replacement = editMatch[2]!.trim();
    const draft = await getPendingDraft(code);
    if (draft) {
      await channel.send(draft.customer_jid, replacement);
      await saveOutbound(draft.conversation_id, replacement);
      await resolveDraft(code, "edited", true);
      await channel.send(config.operatorJid, `Sent your version of ${code}.`);
      log.info({ code }, "operator edited draft");
      return true;
    }
  }

  await channel.send(config.operatorJid, `Not a command. ${HELP}`);
  return true;
}
