/**
 * End-to-end smoke against the REAL database and REAL model.
 * Writes rows under a test JID and removes them at the end.
 */
import { readFileSync, existsSync } from "node:fs";
import { createPipeline } from "../src/action/handler.js";
import { createUnderstander } from "../src/understanding/index.js";
import { config } from "../src/config.js";
import { query, closeDb } from "../src/memory/db.js";
import type { Channel, MessageHandler } from "../src/channel/types.js";

const CUSTOMER = "94770000999@s.whatsapp.net";
const OPERATOR = config.operatorJid;

class Recorder implements Channel {
  readonly name = "recorder";
  sent: Array<{ jid: string; text: string }> = [];
  async start(_h: MessageHandler) {}
  async send(jid: string, text: string) {
    this.sent.push({ jid, text });
    console.log(`  -> ${jid === OPERATOR ? "YOU" : "customer"}: ${text.split("\n")[0]}`);
    if (jid === OPERATOR) for (const line of text.split("\n").slice(1)) console.log(`     ${line}`);
  }
  async stop() {}
  lastCode(): string | null {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      const m = /^\[([a-z0-9]{4})\]/.exec(this.sent[i]!.text);
      if (m) return m[1]!;
    }
    return null;
  }
}

async function cleanup() {
  await query(
    `delete from messages where conversation_id in
       (select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.wa_jid = $1)`,
    [CUSTOMER],
  );
  await query(
    `delete from pending_drafts where conversation_id in
       (select c.id from conversations c join customers cu on cu.id = c.customer_id where cu.wa_jid = $1)`,
    [CUSTOMER],
  );
  await query(
    `delete from order_items where order_id in
       (select o.id from orders o join customers cu on cu.id = o.customer_id where cu.wa_jid = $1)`,
    [CUSTOMER],
  );
  await query(`delete from orders where customer_id in (select id from customers where wa_jid = $1)`, [CUSTOMER]);
  await query(`delete from conversations where customer_id in (select id from customers where wa_jid = $1)`, [CUSTOMER]);
  await query(`delete from customers where wa_jid = $1`, [CUSTOMER]);
}

await cleanup();

const channel = new Recorder();
const pipeline = createPipeline(channel, createUnderstander());
let n = 0;

async function customer(text: string) {
  console.log(`\ncustomer: ${text}`);
  await pipeline.handle({ jid: CUSTOMER, text, waMessageId: `E2E-${++n}`, pushName: "Test Nimal" });
  await pipeline.flush();
}
async function operator(text: string) {
  console.log(`\nyou: ${text}`);
  await pipeline.handle({ jid: OPERATOR, text });
  await pipeline.flush();
}

// A voice note opens the conversation, exactly as a real customer would.
const voicePath = "./tests/fixtures/voice-order.wav";
if (existsSync(voicePath)) {
  console.log("\ncustomer: (voice note)");
  await pipeline.handle({
    jid: CUSTOMER,
    text: "",
    media: [{ kind: "audio", mimeType: "audio/wav", data: readFileSync(voicePath), isVoiceNote: true }],
    waMessageId: `E2E-V${++n}`,
    pushName: "Test Nimal",
  });
  await pipeline.flush();
  const code0 = channel.lastCode();
  if (code0) await operator(`ok ${code0}`);
} else {
  await customer("mata plain t shirt ekak oney, L size, black");
}
await customer("ow ewanna. Nimal Perera, 45/2 Temple Road, Nugegoda, 0771234567");
const code2 = channel.lastCode();
if (code2) await operator(`ok ${code2}`);

console.log("\n" + "=".repeat(60));
const orders = await query<Record<string, unknown>>(
  `select o.id, o.status, o.customer_name, o.phone, o.address, o.city, o.delivery_fee_lkr, o.total_lkr
     from orders o join customers c on c.id = o.customer_id where c.wa_jid = $1`,
  [CUSTOMER],
);
console.log("orders written:", JSON.stringify(orders, null, 2));

const items = await query<Record<string, unknown>>(
  `select oi.product_id, oi.size, oi.colour, oi.quantity, oi.unit_price_lkr
     from order_items oi join orders o on o.id = oi.order_id
     join customers c on c.id = o.customer_id where c.wa_jid = $1`,
  [CUSTOMER],
);
console.log("order lines:", JSON.stringify(items, null, 2));

const turns = await query<{ direction: string; body: string; intent: string | null }>(
  `select m.direction, m.body, m.intent from messages m
     join conversations cv on cv.id = m.conversation_id
     join customers c on c.id = cv.customer_id where c.wa_jid = $1 order by m.id`,
  [CUSTOMER],
);
console.log("\nconversation stored:");
for (const t of turns) console.log(`  ${t.direction === "in" ? "customer" : "shop    "} [${t.intent ?? "-"}] ${t.body.slice(0, 70)}`);

await cleanup();
console.log("\ntest rows removed.");
await closeDb();
