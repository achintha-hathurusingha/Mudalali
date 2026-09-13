# Mudalali · මුදලාලි

**An AI shopkeeper for WhatsApp.** Reads Singlish, drafts the reply, captures the order,
and never sends anything without you.

Built for Sri Lankan shops that sell over WhatsApp. It is not a chatbot: it is an **order pipeline**
with a messy-language problem at the front door, and the AI is one replaceable component inside it.

```
Channel  ->  Understanding  ->  Memory     ->  Action  ->  Human
(WhatsApp)   (one LLM call)     (Postgres)      (reply/    (you approve)
                                 + Knowledge     order/
                                 (catalog)       escalate)
```

## The six layers

| Layer | Where | What it does |
|---|---|---|
| Channel | `src/channel/` | Gets messages in and out. Baileys today, Cloud API later - one new file. |
| Understanding | `src/understanding/` | One call turns `"Mata T shirt eka thiyanwada"` into structured data. |
| Memory | `src/memory/` | Customers, conversations, every message with its predicted intent. |
| Knowledge | `src/knowledge/` | Catalog, prices, stock, delivery rates. The bot is only as correct as this. |
| Action | `src/action/` | Reply, create a draft order, or escalate - decided by `policy.ts`. |
| Human | `src/human/` | The approval loop, over WhatsApp itself. |

**The unit of processing is the conversation, not the message.** `"Mata eka ekak ewanna"` is a
complete order in Sinhala and meaningless as a standalone string - `eka` points at something said
earlier. Every call carries the last N turns.

## Setup

```bash
npm install
cp .env.example .env      # fill in GEMINI_API_KEY, DATABASE_URL, OPERATOR_WA_JID
npm run db:setup          # apply db/schema.sql
npm run db:seed           # load data/catalog.json into Postgres
```

**TLS to a managed Postgres.** Aiven, Supabase and Neon present a CA the system store does not
know. Download your provider's CA certificate, save it as `ca.pem` in the project root (it is
gitignored - it belongs to your project, not this repo), and set `DATABASE_CA_CERT=./ca.pem`.
Without it the connection still works but the server certificate is not verified, and this
database holds customer names, phone numbers and addresses.

`OPERATOR_WA_JID` is your own number as `94771234567@s.whatsapp.net` - drafts and alerts arrive there.

## Try it without WhatsApp

```bash
npm test                               # 19 pipeline tests against an in-memory Postgres. Free, offline.
npm run smoke                          # offline: schema, prompt, delivery rules. No API key needed.
npm run try                            # run data/testset.json through the model
npm run try -- "denim eka kiyada?"     # one ad-hoc message
npm run test:cx                        # 18 multi-turn conversations, asserts on what the customer sees
LLM_PROVIDER=claude npm run test:cx    # same scenarios, other model - compare quality
CHANNEL=console DEBOUNCE_MS=0 npm run dev   # full pipeline in the terminal, `me: <cmd>` acts as operator
```

`npm test` and `npm run smoke` cost nothing. `npm run try` and `npm run test:cx` make real API calls.

## Running for real

```bash
npm run dev     # scan the QR in WhatsApp > Linked devices
```

## How the rollout is sequenced

The failure mode isn't bad classification. It's confidently quoting the wrong price to a real customer.

1. **`POLICY_MODE=suggest`** (the default). Nothing reaches a customer without your approval. Each
   message arrives on your WhatsApp as a draft with a 4-character code:

   ```
   [a3f0] Nimal (94771234567)
   availability 0.93 - suggest-only mode

   > Mata T shirt eka thiyanwada?

   Draft: Ow, thiyenawa! Mona size ekada oney?

   ok a3f0  |  a3f0 <your text>  |  skip a3f0
   ```

   `ok` sends it, `a3f0 <text>` sends your version, `skip` sends nothing. `pending` lists what's waiting.
   `ok` on an order draft also confirms the order; `skip` cancels it. `msg <phone> <text>` messages a
   customer directly through the bot, so the reply still enters conversation memory.
   Every correction you make is evidence for the next prompt change.

2. **`POLICY_MODE=auto`** once you've watched a few hundred real messages. Only intents listed in
   `AUTO_INTENTS` send themselves, and only above `MIN_CONFIDENCE`.

3. **Never automated, in any mode** (`src/action/policy.ts`): bargaining, complaints/returns, and
   order status. Order capture always waits for a human confirmation too - a misread message should
   cost a tap, not a shipment.

   Escalated customers are not left in silence: the model's holding line is sent immediately and you
   get an `OVER TO YOU` handover instead of an approval request. Turn that off with
   `AUTO_ACK_ESCALATIONS=false`.

## Why an LLM and not Dialogflow/Rasa

Singlish has no fixed spelling: `thiyanawada` / `tiyanawada` / `thiyanwada` / `තියනවද` are one word.
Intent-classifier tooling needs training examples per spelling, forever. The model handles the
spelling chaos and the code-mixing (`T shirt eka`) with no curation.

## Two providers, one port

`src/understanding/types.ts` defines the port; `gemini.ts` and `claude.ts` implement it from the same
Zod schema in `schema.ts`. `LLM_PROVIDER` picks one. Run `npm run try` against both on the same
fixtures - Singlish accuracy is the single biggest risk in this build, so measure it rather than assume.

## Things that bite on WhatsApp, and what handles them

| Reality | Where it is handled |
|---|---|
| One thought sent as three messages | `DEBOUNCE_MS` window in `src/action/handler.ts` - the burst becomes one turn, one model call, one draft |
| WhatsApp redelivers on reconnect | unique index on `messages.wa_message_id` plus a check in `recordInbound` |
| You answer a customer from your own phone | `fromMe` messages are recorded as outbound turns, so the model does not contradict you |
| "Dehiwela" / "Colombo 07" / "Mt Lavinia" | `canonicalCity()` - alias table, postal-code stripping, then a typo-tolerant match |
| Customer wants two t-shirts and a dress | `entities.items[]` is a list; `order_items` gets one row per line |
| Item is out of stock, or the size does not exist | refused in `createDraftOrder`, with the reason shown to you |

## What is deliberately not here

- **No vector DB.** The catalog fits in the prompt. RAG is premature until thousands of SKUs.
- **No job queue.** Add one when a slow model call starts blocking inbound messages.
- **No dashboard.** The approval loop runs on WhatsApp, which you already have open.

## Migrating off Baileys

Baileys is unofficial and against WhatsApp's terms - there is a real ban risk on the number your
business depends on. When you move to the Meta Cloud API, write `src/channel/cloud-api.ts` against
the `Channel` interface and change one line in `src/index.ts`. Nothing else in the pipeline knows
which channel it's on. Note the 24-hour window: outbound messages after it need pre-approved templates.

## Data

`messages` stores every message with its predicted intent, confidence, entities, model and latency.
Don't prune it. After a month you'll have a few hundred real Singlish messages - that's the test set
that lets you change the prompt without silently breaking something. `data/testset.json` is the seed.
