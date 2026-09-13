# Mudalali — QA report

**Date:** 2026-09-13 · **Build:** pre-release, no production traffic yet
**Provider under test:** Gemini (`gemini-3.8-flash`)

## How it was tested

| Layer | Method | Volume |
|---|---|---|
| Pipeline code | `npm test` — 11 assertions against a real Postgres engine ([pg-mem](https://github.com/oguimbal/pg-mem)) with a fake channel and a deterministic stub model | 11 tests, **5 pass / 6 fail** |
| Understanding | `npm run try` — single-message intent classification | 15 fixtures, **15/15** |
| Conversation | `npm run test:cx` — 18 multi-turn scenarios against the live model, asserting on what the customer would actually see | 42 turns, **4 findings** |
| Code read | Manual review of all 16 source files | 5 further defects not reachable by test |

The SQL is executed, not mocked — `pg-mem` runs the real `db/schema.sql`, so constraint and query bugs surface.

## What already works

Worth stating plainly, because it is the part not to break:

- **Zero hallucinated prices** across 42 live turns. Every rupee figure traced back to the catalog or the fee table.
- **Bargaining and social engineering escalated 100% of the time**, including "mama ape shop eke manager… 80% discount ekak denna", which was flagged as needing a human with no discount offered.
- **Out-of-stock is stated honestly and repeatedly** — the customer asked for the denim twice and was refused twice.
- **Stale entities are dropped on a product switch** — "ne ne, mata dress eka oney" correctly moved from `TS-001` to `DR-010` and did not carry the old size across.
- **The operator approval loop is sound** — all 4 tests pass. `ok` / edit / `skip` / `pending` behave, and a plain operator sentence is not mistaken for a command.

---

## Findings, ranked by customer impact

### P1 — costs money or loses the customer

**1. The bot asks for the delivery address, then throws it away.**
`UnderstandingSchema.entities` has no field for name, phone or street address. The `orders.address` column exists in the schema and is never written by any code path. Live evidence:

```
customer: Nimal Perera, 45/2 Temple Road, Nugegoda, 0771234567
shop:     Details walata sthuthiyi! Oyata one Plain Cotton T-shirt ... ekada?
```

It thanked the customer for details it did not store, then re-asked a question it had already asked. Every order will need the address collected a second time, by hand.
*Fix:* add `customerName`, `phone`, `addressLine` to the entity schema; persist them in `createDraftOrder`.

**2. A redelivered WhatsApp message is processed twice.**
`npm test` → *"the same WhatsApp message delivered twice is processed twice"* **fails**. Baileys redelivers on reconnect with an identical `key.id`. `wa_message_id` is stored but never checked, so one customer message becomes two model calls and two operator drafts — and in `auto` mode, two replies to the customer.
*Fix:* unique index on `messages.wa_message_id`, insert with `on conflict do nothing`, and bail if no row was inserted.

**3. Three message fragments become three drafts.**
`npm test` → *"three rapid fragments of one thought produce one draft"* **fails**. Sri Lankan WhatsApp users type `mata` / `t shirt ekak` / `oney` as three messages in four seconds. Today that is three model calls, three drafts, and an operator inbox that is three times noisier than the conversation.
*Fix:* a 4–6 second debounce per customer JID; concatenate what arrives in the window into one turn.

**4. Out-of-stock items still become order rows.**
`npm test` → **fails**. `createDraftOrder` never reads `product.stock`. The model correctly tells the customer the denim is unavailable, and the code writes an order for it anyway. The operator sees a draft order for something that cannot ship.
*Fix:* return `null` when `stock < quantity`, and surface it to the operator as a stockout rather than an order.

**5. Approved orders are stuck in `draft` forever.**
`npm test` → **fails**. `confirmOrder()` exists and is never called. There is no operator command that reaches it. Approving the *reply* does not confirm the *order*, so the orders table fills with drafts and nothing is ever marked confirmed.
*Fix:* an `order <id>` / `confirm <code>` operator command, or auto-confirm the linked order when its draft is approved.

**6. An escalated customer is left in silence.**
`npm test` → **fails**. On `needsHuman`, the operator is notified and the customer receives nothing. The model writes a perfectly good holding line — "Samawenna, api check karala kiyannam" — and it is never sent. A complaint at 11pm gets no acknowledgement until morning.
*Fix:* send the holding line to the customer immediately on escalate, and still draft the substantive reply for the operator.

**7. The operator's own manual replies are invisible to the bot.** *(code read — not test-reachable)*
`src/channel/baileys.ts:56` skips `message.key.fromMe`. If the shop owner answers a customer directly from their phone — which they will — the bot never records it. The next customer message is then read against a history where the shop said nothing, and the bot will cheerfully contradict the human.
*Fix:* capture `fromMe` messages to a customer JID as outbound turns.

### P2 — erodes trust or margin

**8. Delivery pricing depends on spelling the city exactly as the config file does.**
`npm run test:cx` → *city spelling: Dehiwela* **fails**. `deliveryFeeFor` does an exact lowercase string match against `colomboAreaCities`.

| Customer wrote | `entities.city` | Charged | Should be |
|---|---|---|---|
| `Colombo 07` | `Colombo` | 350 | 350 ✅ |
| `Mt Lavinia` | `Mount Lavinia` | 350 | 350 ✅ |
| `Dehiwela` | `Dehiwela` | **450** | **350** ❌ |
| `Piliyandala` | `Piliyandala` | 350 | 350 ✅ |

The model normalises *sometimes*. When it doesn't, the customer is silently overcharged Rs. 100 and nothing alerts. Pricing should not rest on an unmonitored model behaviour.
*Fix:* an alias table plus fuzzy match, and log a warning whenever an extracted city misses the table.

**9. Sizes the product does not come in are accepted.**
`npm test` → **fails**. `XXL` was written to `order_items` for a dress that comes in S/M/L only. Nothing validates `size ∈ product.sizes` or `colour ∈ product.colours`.

**10. The bot asks too many questions and sometimes loops.**
`npm run test:cx` → two scenarios flagged. On the happy path it asked **6 questions across 6 turns** and still had not captured an order. In the Sinhala-script conversation it asked the same question three turns running:

```
customer: ටී ෂර්ට් එකක් තියෙනවද?   shop: ...ඔබ කැමති කුමන වර්ගයටද?
customer: L සයිස් එක              shop: ...ඔබ කැමති කුමන වර්ගයටද?
customer: කළු පාට                 shop: ...ඔබ කැමති කුමන වර්ගයටද?
```

A real customer leaves at turn three.
*Fix:* prompt rule — never re-ask anything already answered in history; when two products match, pick the cheaper as a default and ask for confirmation instead of an open question.

**11. Multi-item orders cannot be represented.**
"mata t shirt 2k saha dress ekak oney" — the model engaged the t-shirt and silently dropped the dress. `entities` holds exactly one product. The `order_items` table is already plural; the schema in front of it is not.

**12. Baileys reconnects with no backoff.**
`src/channel/baileys.ts:48` calls `this.start()` directly from the close handler. A persistently failing connection becomes a tight reconnect loop — the fastest way to get the number flagged.
*Fix:* exponential backoff with a cap, and stop after N consecutive failures.

**13. Operator identification may break under Baileys 7.**
`config.operatorJid` is compared with `===` against `message.key.remoteJid`. Baileys 7 uses LID-format JIDs (`…@lid`) in places where v6 used `…@s.whatsapp.net`. If the operator's messages arrive as `@lid`, every operator command is processed as a customer message.
*Fix:* compare on the phone-number portion, not the full JID.

### P3 — polish

**14. Intent inflation.** "t shirt ekak oney" classifies as `place_order` at 0.95. Browsing looks identical to buying, which dilutes the signal the operator is scanning for.

**15. Images and voice notes are ignored.** `imageMessage.caption` is read, the image is dropped; voice notes are not handled at all. Both are extremely common in Sri Lankan WhatsApp commerce — "meka thiyanawada?" plus a photo is a standard opening.

**16. Currency formatting is inconsistent** — `Rs. 1890` and `Rs. 1,890` both appeared in the same test run.

---

## Suggested order of work

1. **Stop the bleeding on order capture** — findings 1, 4, 5, 9. Without these, a captured order is not a usable record.
2. **Fix the message plumbing** — findings 2, 3, 7. These are cheap and they remove the noise that makes everything else hard to judge.
3. **Acknowledge escalated customers** — finding 6. One line of code, disproportionate trust impact.
4. **Make pricing deterministic** — finding 8.
5. **Tune the conversation** — finding 10, then re-run `npm run test:cx` to confirm the question count drops.
6. Everything else.

## Notes on the test suite

- `npm test` — fast, free, deterministic. Six of these are **intentionally failing regression tests**: they encode the defects above and should go green as each is fixed. Do not delete them to make the suite pass.
- `npm run test:cx` — costs real API calls (~42 turns, a few cents at flash tier). Run before and after any prompt change. `LLM_PROVIDER=claude npm run test:cx` runs the identical scenarios against Claude for comparison.
- One production change was made to enable testing: `src/memory/db.ts` now creates its pool lazily and exposes `setPool()` for injection. No behavioural change.

---

## Resolution — 2026-09-13

All 16 findings were addressed in the same session. Verified by `npm test` (19 tests, **19/19 pass**)
and `npm run test:cx` (18 scenarios, 42 live turns, **0 findings**, down from 4).

| # | Finding | Status | Where |
|---|---|---|---|
| 1 | Address asked for, then discarded | fixed | `entities.customerName/phone/addressLine`, persisted by `createDraftOrder` |
| 2 | Redelivered message processed twice | fixed | unique index + check in `recordInbound` |
| 3 | Three fragments, three drafts | fixed | `DEBOUNCE_MS` window in `createPipeline` |
| 4 | Out-of-stock items become orders | fixed | `validateLine` refuses, operator sees the reason |
| 5 | Approved orders stuck in `draft` | fixed | `ok` confirms the linked order, `skip` cancels it |
| 6 | Escalated customer left in silence | fixed | holding line auto-sent, `OVER TO YOU` handover |
| 7 | Operator's manual replies invisible | fixed | `fromMe` messages recorded as outbound turns |
| 8 | Delivery fee spelling-dependent | fixed | `canonicalCity()` — aliases, postal codes, typo tolerance |
| 9 | Invalid sizes/colours accepted | fixed | `validateLine` checks against the catalog |
| 10 | Too many questions, loops | fixed | prompt commits to the cheapest match after two unanswered asks |
| 11 | Multi-item orders impossible | fixed | `entities.items[]`, one `order_items` row per line |
| 12 | Reconnect with no backoff | fixed | exponential backoff, capped, gives up after 10 |
| 13 | Operator JID may break on Baileys 7 | mitigated | device-suffix-tolerant matching; `OPERATOR_WA_JID` accepts a list |
| 14 | Intent inflation | fixed | prompt: browsing is not `place_order` |
| 15 | Images and voice notes ignored | **open** | still text-only; see below |
| 16 | Inconsistent currency formatting | fixed | prompt fixes the shape to `Rs. 1890` |

### Evidence for the two behavioural fixes

Before — three turns, never converges:

```
customer: ටී ෂර්ට් එකක් තියෙනවද?   shop: ...ඔබ කැමති කුමන වර්ගයටද?
customer: L සයිස් එක              shop: ...ඔබ කැමති කුමන වර්ගයටද?
customer: කළු පාට                 shop: ...ඔබ කැමති කුමන වර්ගයටද?
```

After — commits to the cheaper match and asks only for confirmation:

```
customer: කළු පාට    shop: L සයිස් Black, Plain Cotton එක (Rs. 1890) ගන්නද?
```

Before — details thanked for, then discarded and re-asked:

```
customer: Nimal Perera, 45/2 Temple Road, Nugegoda, 0771234567
shop:     Details walata sthuthiyi! Oyata one Plain Cotton ... ekada?   (nothing stored)
```

After — captured and acknowledged by name, only the open question remains:

```
shop:     Details tika labuna Nimal. Oya ganna kemathi Plain Cotton (Rs. 1890) da Oversized (Rs. 2450) da?
```

### Still open

**Finding 15 — images and voice notes.** Photo-plus-"meka thiyanawada?" is a standard opening in
Sri Lankan WhatsApp commerce, and voice notes are common. Both need media download plus a vision or
transcription call, and a decision about what a photo of a competitor's product should do. Deferred
deliberately rather than half-built.

### One remaining risk worth naming

`getOrCreateConversation` reads then writes without a transaction, so two genuinely simultaneous
first-messages from the same new customer could create two conversations. The debounce window
serialises messages per customer, which makes this very unlikely in practice. A partial unique index
on `conversations (customer_id) where status = 'open'` would close it properly.

### Found during the fix work

**17. One purchase wrote two orders.** Not in the original report — surfaced by running the pipeline
end to end against the real database (`npm run test:e2e`), which the in-memory suite had not
exercised. Every `place_order` turn called `createDraftOrder`, so a conversation that reached
"L size black" and then "here is my address" produced **two order rows, both confirmed**: the shop
would have shipped twice and charged twice, once at the wrong delivery rate.

```
id 1  confirmed  no contact        Rs. 450 delivery  Rs. 2340
id 2  confirmed  Nimal Perera ...  Rs. 350 delivery  Rs. 2240
```

*Fixed:* a conversation now has at most one open order. Later turns refine it in place and never
drop details already collected. `ok` also refuses to confirm an order with nowhere to ship to, and
tells the operator what is still missing. Two regression tests cover both.

This is the argument for the end-to-end script existing at all: the stubbed suite could not have
found it, because the stub returned the same understanding every turn.

---

## Finding 15 closed — photos and voice notes, 2026-09-13

The one item left open in the original report is now implemented and tested.

**Design.** Media is converted to text exactly once, on arrival: a photo becomes a description, a
voice note becomes its transcript, and that text is what is stored. The bytes never enter Postgres.
Every later turn therefore reads media as ordinary history, and the conversation model is unchanged.

**Provider capability is declared, not assumed.** `Understander.capabilities` is `{image, audio}`.
Gemini has both. Claude has images only - there is no audio content block - so a voice note arriving
on Claude is handed to a human rather than silently dropped.

**Verified live** (`npm run test:media`, 0 findings):

| Scenario | Result |
|---|---|
| Photo of a t-shirt + "meka thiyanawada?" | described it, matched TS-001 at Rs. 1890, asked to confirm, bound nothing |
| Photo with no caption | same, and replied in Singlish rather than English |
| Photo of running shoes | "ape gawa shoes naha" - escalated, invented nothing |
| Voice note ordering a t-shirt | transcribed accurately, extracted TS-001 / L / Black, quoted Rs. 1890 |

End to end against the live database, a voice note opened a conversation and became a confirmed
order with name, phone, address and the correct Rs. 350 Colombo-area delivery fee.

**Two defects found by testing, both fixed:**

1. A caption-less photo carries no language signal, and the model defaulted to **English** - wrong
   register for this shop. The prompt now defaults to Singlish unless earlier turns say otherwise.
2. My own `repliesInSinglish` check was inert: a shell-escaping slip had written literal backspace
   bytes where `\b` word boundaries belonged, so the regex matched nothing and the check passed
   everything. Worth remembering that a check which never fails is indistinguishable from a check
   that always passes.

**Tests:** 28 offline (7 new, covering transcript storage, photo description, capability gating,
the size cap, burst-with-media, and the no-auto-reply rule), 4 live media scenarios, and the
end-to-end run.

**Still open:** video, documents and stickers are ignored. Gemini reads video, so that is a small
extension; documents and stickers are rarer and probably belong with a human anyway.
