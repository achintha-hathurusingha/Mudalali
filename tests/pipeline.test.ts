import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useTestDb, FakeChannel, StubUnderstander, draftCode } from "./helpers.js";
import { createPipeline } from "../src/action/handler.js";
import { config } from "../src/config.js";
import { query } from "../src/memory/db.js";
import type { Understanding } from "../src/understanding/schema.js";

const CUSTOMER = "94771111111@s.whatsapp.net";
const OPERATOR = config.operatorJid;

beforeEach(async () => {
  await useTestDb();
});

/** Drives the pipeline and drains the debounce window, as a real burst would. */
function drive(channel: FakeChannel, reply: (input: { message: string }) => Partial<Understanding>) {
  const understander = new StubUnderstander(reply);
  const pipeline = createPipeline(channel, understander);
  return {
    understander,
    async send(...messages: Array<Parameters<typeof pipeline.handle>[0]>) {
      for (const message of messages) await pipeline.handle(message);
      await pipeline.flush();
    },
  };
}

describe("inbound handling", () => {
  test("a customer message produces exactly one draft for the operator", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({ intent: "availability" }));

    await send({ jid: CUSTOMER, text: "T shirt thiyanawada?", waMessageId: "MSG1" });

    assert.equal(channel.to(CUSTOMER).length, 0, "customer must not be messaged in suggest mode");
    assert.equal(channel.to(OPERATOR).length, 1);
    const rows = await query<{ n: string }>(`select count(*) as n from pending_drafts`);
    assert.equal(Number(rows[0]!.n), 1);
  });

  test("the same WhatsApp message delivered twice is only processed once", async () => {
    const channel = new FakeChannel();
    const { send, understander } = drive(channel, () => ({ intent: "availability" }));

    // Baileys redelivers on reconnect; the message id is identical.
    await send({ jid: CUSTOMER, text: "T shirt thiyanawada?", waMessageId: "MSG1" });
    await send({ jid: CUSTOMER, text: "T shirt thiyanawada?", waMessageId: "MSG1" });

    assert.equal(understander.calls, 1, "the model should only be paid for once");
    assert.equal(channel.to(OPERATOR).length, 1, "the operator should see one draft, not two");
  });

  test("three rapid fragments of one thought produce one draft", async () => {
    const channel = new FakeChannel();
    const { send, understander } = drive(channel, () => ({ intent: "availability" }));

    // How people actually type on WhatsApp in Sri Lanka.
    await send(
      { jid: CUSTOMER, text: "mata", waMessageId: "A" },
      { jid: CUSTOMER, text: "t shirt ekak", waMessageId: "B" },
      { jid: CUSTOMER, text: "oney", waMessageId: "C" },
    );

    assert.equal(channel.to(OPERATOR).length, 1, "one intent should mean one draft");
    assert.equal(understander.calls, 1, "and one model call");
    const rows = await query<{ body: string }>(`select body from messages where direction = 'in'`);
    assert.equal(rows[0]!.body, "mata\nt shirt ekak\noney", "the fragments are joined into one turn");
  });

  test("a reply the shop owner typed on their own phone enters conversation memory", async () => {
    const channel = new FakeChannel();
    const { send, understander } = drive(channel, () => ({}));

    await send({ jid: CUSTOMER, text: "thiyanawada?", waMessageId: "M1" });
    await send({ jid: CUSTOMER, text: "Ow thiyenawa, mama balannam", waMessageId: "M2", fromMe: true });

    const out = await query<{ body: string }>(`select body from messages where direction = 'out'`);
    assert.deepEqual(
      out.map((r) => r.body),
      ["Ow thiyenawa, mama balannam"],
      "otherwise the model contradicts a human who already answered",
    );
    assert.equal(understander.calls, 1, "the shop's own message must not be classified");
  });
});

describe("operator approval loop", () => {
  test("ok <code> sends the draft and records it as an outbound turn", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({ draftReply: "Ow thiyenawa!" }));

    await send({ jid: CUSTOMER, text: "thiyanawada?", waMessageId: "MSG1" });
    const code = draftCode(channel.to(OPERATOR)[0]!.text);
    channel.clear();

    await send({ jid: OPERATOR, text: `ok ${code}` });

    assert.deepEqual(
      channel.to(CUSTOMER).map((s) => s.text),
      ["Ow thiyenawa!"],
    );
    const out = await query<{ body: string }>(`select body from messages where direction = 'out'`);
    assert.equal(out.length, 1, "the sent reply must enter conversation memory");
  });

  test("an edited reply is what the customer receives", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({ draftReply: "wrong draft" }));

    await send({ jid: CUSTOMER, text: "thiyanawada?", waMessageId: "MSG1" });
    const code = draftCode(channel.to(OPERATOR)[0]!.text);
    channel.clear();

    await send({ jid: OPERATOR, text: `${code} Ow, black L size thiyenawa` });

    assert.deepEqual(
      channel.to(CUSTOMER).map((s) => s.text),
      ["Ow, black L size thiyenawa"],
    );
  });

  test("an operator plain sentence is not mistaken for a command", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({}));

    // "send" is four characters, which is exactly the draft-code shape.
    await send({ jid: OPERATOR, text: "send them the bank details" });

    const replies = channel.to(OPERATOR);
    assert.equal(replies.length, 1);
    assert.match(replies[0]!.text, /Not a command/);
  });

  test("an operator arriving on a linked device is still recognised", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({}));

    // Linked devices append :NN to the user part.
    const operatorOnLaptop = OPERATOR.replace("@", ":12@");
    await send({ jid: operatorOnLaptop, text: "pending" });

    assert.equal(channel.to(OPERATOR).length, 1);
    assert.match(channel.to(OPERATOR)[0]!.text, /Nothing waiting/);
  });

  test("msg <phone> <text> reaches the customer and is remembered", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({}));

    await send({ jid: CUSTOMER, text: "thiyanawada?", waMessageId: "MSG1" });
    channel.clear();

    await send({ jid: OPERATOR, text: "msg 94771111111 Ow, heta ewannam" });

    assert.deepEqual(
      channel.to(CUSTOMER).map((s) => s.text),
      ["Ow, heta ewannam"],
    );
    const out = await query<{ body: string }>(`select body from messages where direction = 'out'`);
    assert.equal(out.length, 1);
  });
});

describe("order capture", () => {
  const orderUnderstanding: Partial<Understanding> = {
    intent: "place_order",
    orderReady: true,
    entities: {
      items: [{ productId: "TS-001", productName: "t shirt", size: "L", colour: "Black", quantity: 1 }],
      customerName: "Nimal Perera",
      phone: "0771234567",
      addressLine: "45/2 Temple Road",
      city: "Colombo",
      refersToEarlier: true,
    },
  };

  test("a ready order writes a draft order with contact details and correct totals", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => orderUnderstanding);

    await send({ jid: CUSTOMER, text: "mata eka ekak ewanna", waMessageId: "MSG1" });

    const orders = await query<{
      id: number; status: string; total_lkr: number; delivery_fee_lkr: number;
      customer_name: string; phone: string; address: string; city: string;
    }>(`select id, status, total_lkr, delivery_fee_lkr, customer_name, phone, address, city from orders`);

    assert.equal(orders.length, 1);
    const order = orders[0]!;
    assert.equal(order.status, "draft");
    assert.equal(order.delivery_fee_lkr, 350, "Colombo is a Colombo-area city");
    assert.equal(order.total_lkr, 1890 + 350);
    assert.equal(order.customer_name, "Nimal Perera", "the address the bot asked for must be stored");
    assert.equal(order.phone, "0771234567");
    assert.equal(order.address, "45/2 Temple Road");
  });

  test("approving the reply confirms the order", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => orderUnderstanding);

    await send({ jid: CUSTOMER, text: "mata eka ekak ewanna", waMessageId: "MSG1" });
    const code = draftCode(channel.to(OPERATOR)[0]!.text);
    await send({ jid: OPERATOR, text: `ok ${code}` });

    const orders = await query<{ status: string }>(`select status from orders`);
    assert.equal(orders[0]!.status, "confirmed");
  });

  test("skipping the reply cancels the draft order", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => orderUnderstanding);

    await send({ jid: CUSTOMER, text: "mata eka ekak ewanna", waMessageId: "MSG1" });
    const code = draftCode(channel.to(OPERATOR)[0]!.text);
    await send({ jid: OPERATOR, text: `skip ${code}` });

    const orders = await query<{ status: string }>(`select status from orders`);
    assert.equal(orders[0]!.status, "cancelled");
  });

  test("an out-of-stock item never becomes an order", async () => {
    const channel = new FakeChannel();
    // DN-020 has stock 0 in the catalog.
    const { send } = drive(channel, () => ({
      ...orderUnderstanding,
      entities: {
        ...orderUnderstanding.entities!,
        items: [{ productId: "DN-020", productName: "denim", size: "32", colour: "Blue", quantity: 1 }],
      },
    }));

    await send({ jid: CUSTOMER, text: "denim ekak ewanna", waMessageId: "MSG1" });

    const orders = await query<{ id: number }>(`select id from orders`);
    assert.equal(orders.length, 0);
    assert.match(channel.to(OPERATOR)[0]!.text, /out of stock/, "the operator is told why");
  });

  test("a size the product does not come in is refused", async () => {
    const channel = new FakeChannel();
    // DR-010 comes in S, M, L only.
    const { send } = drive(channel, () => ({
      ...orderUnderstanding,
      entities: {
        ...orderUnderstanding.entities!,
        items: [{ productId: "DR-010", productName: "dress", size: "XXL", colour: "Blue", quantity: 1 }],
      },
    }));

    await send({ jid: CUSTOMER, text: "dress ekak XXL", waMessageId: "MSG1" });

    const items = await query<{ size: string }>(`select size from order_items`);
    assert.equal(items.length, 0);
    assert.match(channel.to(OPERATOR)[0]!.text, /not offered/);
  });

  test("more stock than exists is refused", async () => {
    const channel = new FakeChannel();
    // DR-010 has stock 6.
    const { send } = drive(channel, () => ({
      ...orderUnderstanding,
      entities: {
        ...orderUnderstanding.entities!,
        items: [{ productId: "DR-010", productName: "dress", size: "M", colour: "Blue", quantity: 10 }],
      },
    }));

    await send({ jid: CUSTOMER, text: "dress 10k oney", waMessageId: "MSG1" });

    assert.equal((await query(`select id from orders`)).length, 0);
    assert.match(channel.to(OPERATOR)[0]!.text, /only 6 left/);
  });

  test("a two-item order writes both lines and sums them", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({
      ...orderUnderstanding,
      entities: {
        ...orderUnderstanding.entities!,
        items: [
          { productId: "TS-001", productName: "t shirt", size: "L", colour: "Black", quantity: 2 },
          { productId: "DR-010", productName: "dress", size: "S", colour: "Red", quantity: 1 },
        ],
      },
    }));

    await send({ jid: CUSTOMER, text: "t shirt 2k saha dress ekak", waMessageId: "MSG1" });

    const items = await query<{ product_id: string }>(`select product_id from order_items order by product_id`);
    assert.deepEqual(items.map((i) => i.product_id), ["DR-010", "TS-001"]);

    const orders = await query<{ total_lkr: number }>(`select total_lkr from orders`);
    // 1890*2 + 4900 = 8680, under the Rs 10000 free-delivery threshold, Colombo = 350
    assert.equal(orders[0]!.total_lkr, 1890 * 2 + 4900 + 350);
  });

  test("a second order turn refines the same order instead of creating another", async () => {
    const channel = new FakeChannel();
    let turn = 0;
    const { send } = drive(channel, () => {
      turn++;
      // First: items known, no contact yet. Then: the address arrives.
      return turn === 1
        ? {
            ...orderUnderstanding,
            entities: {
              ...orderUnderstanding.entities!,
              customerName: null, phone: null, addressLine: null, city: null,
            },
          }
        : orderUnderstanding;
    });

    await send({ jid: CUSTOMER, text: "plain t shirt L black ekak oney", waMessageId: "M1" });
    await send({ jid: CUSTOMER, text: "Nimal Perera, 45/2 Temple Road, Colombo, 0771234567", waMessageId: "M2" });

    const orders = await query<{ id: number; customer_name: string; total_lkr: number }>(
      `select id, customer_name, total_lkr from orders`,
    );
    assert.equal(orders.length, 1, "one purchase must be one order, or the shop ships twice");
    assert.equal(orders[0]!.customer_name, "Nimal Perera", "the later turn fills in what was missing");

    const items = await query<{ product_id: string }>(`select product_id from order_items`);
    assert.equal(items.length, 1, "and the line is replaced, not duplicated");
  });

  test("an order with nowhere to ship to is not confirmed by ok", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({
      ...orderUnderstanding,
      entities: {
        ...orderUnderstanding.entities!,
        customerName: null, phone: null, addressLine: null, city: null,
      },
    }));

    await send({ jid: CUSTOMER, text: "plain t shirt L black ekak oney", waMessageId: "M1" });
    const code = draftCode(channel.to(OPERATOR)[0]!.text);
    channel.clear();
    await send({ jid: OPERATOR, text: `ok ${code}` });

    const orders = await query<{ status: string }>(`select status from orders`);
    assert.equal(orders[0]!.status, "draft", "confirming an order with no address would ship nowhere");
    assert.match(channel.to(OPERATOR)[0]!.text, /still needs name, phone, address/);
  });

  test("a spelling variant of a Colombo suburb is not overcharged", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => ({
      ...orderUnderstanding,
      entities: { ...orderUnderstanding.entities!, city: "Dehiwela" },
    }));

    await send({ jid: CUSTOMER, text: "Dehiwela ta ewanna", waMessageId: "MSG1" });

    const orders = await query<{ delivery_fee_lkr: number; city: string }>(
      `select delivery_fee_lkr, city from orders`,
    );
    assert.equal(orders[0]!.delivery_fee_lkr, 350, "Dehiwela is Dehiwala");
    assert.equal(orders[0]!.city, "dehiwala", "stored in canonical form");
  });
});

describe("escalation", () => {
  const complaint: Partial<Understanding> = {
    intent: "complaint_return",
    needsHuman: true,
    needsHumanReason: "complaint",
    draftReply: "Samawenna, api check karala kiyannam.",
  };

  test("an escalated customer is acknowledged immediately", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => complaint);

    await send({ jid: CUSTOMER, text: "wrong size awa", waMessageId: "MSG1" });

    assert.deepEqual(
      channel.to(CUSTOMER).map((s) => s.text),
      ["Samawenna, api check karala kiyannam."],
      "silence until the operator wakes up is how trust is lost",
    );
    const out = await query<{ body: string }>(`select body from messages where direction = 'out'`);
    assert.equal(out.length, 1, "and it must be in memory so the model knows it was said");
  });

  test("the operator gets a handover, not an approval request", async () => {
    const channel = new FakeChannel();
    const { send } = drive(channel, () => complaint);

    await send({ jid: CUSTOMER, text: "wrong size awa", waMessageId: "MSG1" });

    const notice = channel.to(OPERATOR)[0]!.text;
    assert.match(notice, /OVER TO YOU/);
    assert.match(notice, /Already sent:/);
    assert.match(notice, /msg 94771111111/, "tells the operator how to reply through the bot");
    assert.equal((await query(`select id from pending_drafts`)).length, 0, "nothing to approve");
  });
});
