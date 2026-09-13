# Mudalali admin console — build guide

**What it is:** a web back-office for the shop owner. Add and edit products, keep stock accurate,
change how the AI agent behaves, approve replies, and watch orders — without touching `.env`,
a terminal, or WhatsApp commands.

**Date:** 2026-09-13

---

## 1. The blocker you have to fix first

Right now every setting the owner would want to change lives in `.env` and is **read once at process
startup**:

```
POLICY_MODE=auto                 MIN_CONFIDENCE=0.8
AUTO_INTENTS=greeting,...        AUTO_REPLY_MEDIA=false
DEBOUNCE_MS=3000                 AUTO_ACK_ESCALATIONS=true
```

A web button cannot change a value that was baked into a running process. **Nothing else in this plan
works until settings move into Postgres and the agent reads them per message.**

That is a small, self-contained change:

```sql
create table if not exists settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
```

`src/config.ts` keeps providing the defaults; a thin `settings` layer overlays whatever the database
says, cached for a few seconds so it is not a query per message. The console writes a row, the agent
picks it up on the next message. No restart, no deploy.

It also gives you an audit trail — *who* flipped the shop into auto mode at 11pm, and when.

**Do this first.** It is maybe an hour, and every screen below depends on it.

---

## 2. The screens

Ordered by how much pain each removes.

### Approvals — the one that matters

Today you approve by typing `ok a3f0` into WhatsApp. That works, but it is a bad interface for the
one thing you do fifty times a day.

The screen: a live queue of `pending_drafts`, each showing the customer, what they said, the drafted
reply, its intent and confidence, and — when there is one — the draft order. Approve, edit, or skip.
Keyboard-first, because it is repetitive: `j`/`k` to move, `Enter` to send, `e` to edit.

**Track your edits.** Every time you rewrite a draft, that is a labelled training example telling you
exactly where the prompt is wrong. `pending_drafts.status` already records `sent` / `edited` /
`skipped` — an edit rate per intent is the single most useful number in this whole system.

### Agent controls

One page, honest switches, each explaining its consequence rather than its variable name:

| Control | What the owner sees |
|---|---|
| `POLICY_MODE` | **Suggest** — nothing sends without you. **Auto** — safe replies send themselves |
| `AUTO_INTENTS` | Which kinds of message may answer themselves (checkboxes, not a CSV string) |
| `MIN_CONFIDENCE` | How sure the AI must be before it replies alone |
| `AUTO_REPLY_MEDIA` | Whether a photo may be answered without you |
| `AUTO_ACK_ESCALATIONS` | Whether customers get an instant "we'll check" when handed to you |
| `DEBOUNCE_MS` | How long to wait for someone still typing |

Plus a prominent **pause** — stop replying to everyone, now. You will want it the first time something
goes wrong, and hunting for a terminal is not an option when a customer is waiting.

### Catalog & inventory

CRUD over the `catalog` table: name, Sinhala name, price, sizes, colours, stock, active.

Two things that make it genuinely useful rather than a generic table:

- **Photo upload per colour**, writing into `data/product-photos.json` — the same index the agent uses
  to answer "photo ewanna". Today that mapping is hand-built. It should be a drag-and-drop.
- **Stock is load-bearing.** `createDraftOrder` already refuses orders it cannot fill, so a wrong
  number here silently loses sales. Show low stock prominently.

### Orders

`orders` + `order_items`, filtered by status. Confirm, cancel, mark shipped. Show the contact details
the agent captured, and flag anything still missing an address.

### Conversations

Read-only history, the way the model sees it — including the `[photo: ...]` and voice-note transcripts
that stand in for media. This is where you find out *why* it said something odd. Filter by intent and
by `needs_human`.

### Health

Not vanity metrics — the four numbers that tell you whether to trust it:

- **Edit rate by intent** (from `pending_drafts.status`) — where the prompt is wrong
- **Escalation rate** — how much it is handing back to you
- **Confidence distribution** — is it guessing?
- **Latency and model** — `messages` already stores `latency_ms` and `model` per turn

Every one of these is a query away. The data is already being written.

---

## 3. Stack

**Next.js (App Router) + Tailwind + shadcn/ui, on Vercel's free tier, talking to the same Aiven
Postgres.**

Reasoning, briefly: this needs a server (it writes to a database), so static hosting is out. shadcn
gives you tables, dialogs, forms and toasts that already look right — an admin panel is 90% those four
things, and hand-rolling them is where the time goes.

**Keep it a separate app from the agent.** Tempting to serve the UI from the agent process, but then
the console dies exactly when you need it — while the agent is broken. Separate deploys, shared
database.

**Authentication is not optional.** This page edits prices and reads every customer's phone number and
address. Even single-user, put a real login in front of it before it is on the public internet. A
password in an env var behind a middleware check is the minimum; a magic link is better.

---

## 4. Resources

### Skills

Project skills live in `.claude/skills/<name>/SKILL.md`, are committed to git, and load **only when
invoked** — so a big reference costs nothing until needed.

Worth writing for this build:

| Skill | Why |
|---|---|
| `schema` | Injects the live schema with `` !`cat db/schema.sql` `` so Claude never invents a column |
| `admin-ui` | Your table/form/dialog conventions, so screen six looks like screen one |
| `dataviz` (bundled) | Load before building the health charts |
| `frontend-design` (Anthropic) | Forces a committed aesthetic instead of the default AI look |

The `schema` skill is the highest-value one here. Most dashboard bugs are a column that does not exist.

### Subagents

`.claude/agents/<name>.md`, each with its own context window, returning only a summary.

| Agent | For |
|---|---|
| `Explore` (built in) | "Where does the agent read POLICY_MODE?" |
| `visual-qa` | Screenshot each screen at 390/768/1440 and report only what breaks |
| `sql-review` | Check queries for missing indexes and N+1s before they reach production |

Do not use a subagent for work needing back-and-forth — they start fresh with no shared context.

### Connectors (MCP)

```bash
claude mcp add --transport stdio db -- npx -y @bytebase/dbhub --dsn "$DATABASE_URL"
claude mcp add --transport stdio chrome -- npx -y chrome-devtools-mcp
claude mcp list
```

| Connector | What it unlocks |
|---|---|
| **Postgres** ([DBHub](https://github.com/bytebase/dbhub)) | Claude reads the real schema and real rows instead of guessing |
| **[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)** | Opens a browser, reads the console, checks the network tab |
| **Playwright MCP** | Drives the UI, fills forms, screenshots. Accessibility-tree snapshots (2–5KB) rather than images (500KB+) |
| **[shadcn/ui MCP](https://github.com/Jpisnice/shadcn-ui-mcp-server)** | Real component source instead of hand-rolled approximations |

Point the Postgres connector at a **read-only role** for exploration. Do not hand a coding agent write
credentials to the database holding your customers' addresses.

MCP servers cost context — the community toolkit measures ~55k tokens before you type anything with
several loaded. Enable what today's work needs.

Community catalogues worth mining, with the caveat that a skill is *instructions that run in your
session*, so read before installing:
[awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) ·
[awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents) ·
[Frontend Design Toolkit](https://github.com/wilwaldon/Claude-Code-Frontend-Design-Toolkit)

### Prompts

1. **`/init` first.** It writes the `CLAUDE.md` every later session inherits.
2. **Plan mode before anything structural.** Correct the wrong assumption before thirty files exist.
3. **Name the aesthetic and forbid the defaults:**

   > Build the approvals queue. Dense, calm, keyboard-first — a working tool someone uses for an hour
   > a day, not a marketing page. Information density over whitespace. No purple gradients, no glass
   > morphism, no emoji headings. Show me the row component only, then stop.

4. **"Show me one, then stop."** Review one row before it generates six screens.
5. **Make it check its own work:** *"Screenshot at 390px and 1440px and tell me what looks wrong
   before I do."*

---

## 5. How to get something that actually works

Drawn from building the agent in this repo, not from theory.

**Give it a browser or it is guessing.** The agent passed every test and then broke three ways on real
WhatsApp — `@lid` identifiers, container-wrapped messages vanishing silently, three processes fighting
over one session. None findable without running it for real. A dashboard fails the same way: code that
typechecks can still be unusable on a phone.

**Write tests that can fail.** A Singlish check here reported zero problems for two full runs because a
shell-escaping slip had put literal backspace bytes in the regex — it matched nothing and passed
everything. Break it on purpose and confirm it goes red.

**Use real data.** Point the console at the real Aiven database from day one. A product table looks
fine with four rows and falls apart with a long Sinhala name, a missing photo and an out-of-stock badge.

**Small increments, verified, pushed.** Batched changes hid the same escaping bug three times. One
change → typecheck → test → look → commit → push.

**Fix causes, not symptoms.** When the agent ignored "how do I order" and asked for a size, the fix was
not that reply — an earlier prompt rule had overridden answering questions. One change fixed every
future conversation. Same for UI: if a screen is misaligned, fix the spacing scale.

---

## 6. Build order

| Step | What | Done when |
|---|---|---|
| 1 | `settings` table + runtime overlay in the agent | Changing a row changes behaviour with no restart |
| 2 | Next.js app, auth, database connection | You can log in and nothing else can |
| 3 | Agent controls page | You can flip suggest/auto from your phone |
| 4 | Approvals queue | You stop typing `ok a3f0` |
| 5 | Catalog & inventory, with photo upload | You add a product without editing JSON |
| 6 | Orders | You mark something shipped |
| 7 | Conversations | You can read why it said something |
| 8 | Health | You can see the edit rate per intent |

Steps 1, 3 and 4 remove most of the daily pain. Ship those before building anything else.

---

## 7. Honest limits

- **Claude Code is good at structure, average at taste.** It will produce clean, working, responsive
  screens. Making them feel good still takes you saying "denser", "calmer", repeatedly.
- **The agent must keep working while you build this.** Separate app, separate deploy, shared database
  — so a broken console never takes the shop offline.
- **Claude Code details here** (skills, subagents, MCP) are from the official docs, checked
  2026-09-13. The design tactics are community sources plus experience in this repo — opinions, not
  documentation.
