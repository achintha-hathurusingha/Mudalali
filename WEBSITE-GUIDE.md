# Building the shop website with Claude Code

**For:** Mudalali — a Sri Lankan clothing shop that already sells on WhatsApp
**Date:** 2026-09-13

---

## 1. Decide what the site is actually for

This is the decision that determines everything else, and it is easy to get wrong.

You already have a working order pipeline on WhatsApp. Customers message, the agent reads Singlish,
captures the order, you approve. **The website must not try to be a second, competing checkout.**
A webshop would give you two order systems, two inventory truths, and two places for a customer to
get stuck — and the one people actually use in Sri Lanka is WhatsApp.

The website's job is narrower and far more achievable:

| The site does | The site does not |
|---|---|
| Show the catalog properly — real photos, prices, sizes, stock | Take payments |
| Build trust: who you are, delivery, returns, real reviews | Hold a cart |
| Answer the questions that clog your inbox (delivery cost, COD, sizing) | Duplicate inventory |
| Hand off to WhatsApp with the product already in the message | Require an account |

The single most important element on every product is a WhatsApp deep link:

```
https://wa.me/94722607429?text=Mata%20Plain%20Cotton%20T-Shirt%20(Black%2C%20L)%20ekak%20oney
```

The customer taps it, WhatsApp opens with the message pre-filled, they hit send — and your agent
already knows the product, colour and size before the conversation starts. The website becomes a
**catalogue that feeds the pipeline you have already built and tested.**

That also means you can share one source of truth: the same `data/catalog.json` and
`data/product-photos/` this repo already uses.

---

## 2. Resources

### 2.1 Skills

Skills are folders with a `SKILL.md`. Claude loads them automatically when the `description` matches
what you are doing, or you invoke them with `/name`. Bodies load **only when invoked**, so a large
reference costs nothing until needed — unlike `CLAUDE.md`, which is always in context.

```
.claude/skills/<name>/SKILL.md    ← project, committed to git, shared with the team
~/.claude/skills/<name>/SKILL.md  ← personal, all your projects
```

Useful frontmatter: `description` (how Claude decides to use it), `allowed-tools` (pre-approve
commands so it stops asking), `context: fork` (run in an isolated subagent), `disable-model-invocation`
(user-only). A `` !`command` `` line in the body runs before Claude sees the skill and injects live output.

**Worth having for this build:**

| Skill | Why |
|---|---|
| **frontend-design** (Anthropic) | Forces Claude to commit to a named aesthetic before writing code, instead of defaulting to the generic purple-gradient look every AI produces |
| **A project `brand` skill** | Your colours, type, tone, the Sinhala/English rules. Write once, every session obeys it |
| **A project `catalog` skill** | Injects the live catalog with `` !`cat data/catalog.json` `` so pages are never built against stale product data |
| [awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | ~1000 community skills; useful for animation and Tailwind v4 patterns |

The highest-value one is the brand skill, because it is the thing no library can give you.

### 2.2 Subagents

Subagents run in their **own context window** and return only a summary. Define them in
`.claude/agents/<name>.md` with `name`, `description`, and optionally `tools`, `model`, `effort`.

Use one when the work would otherwise flood the main conversation with output you will never read
again. Do **not** use one for work that needs back-and-forth — they start fresh with no shared context.

| Agent | Good for |
|---|---|
| `Explore` (built in) | "Where is the checkout logic?" across an unfamiliar repo |
| `Plan` (built in) | Research before a big change, via plan mode |
| A `visual-qa` agent | Screenshot every page at 3 widths, report only what looks broken |
| A `copy-review` agent | Check Sinhala/Singlish copy reads naturally, not machine-translated |

[VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
has 100+ ready-made ones. Take them as starting points, not gospel — a generic "frontend-developer"
agent knows nothing about your shop.

### 2.3 Connectors (MCP)

MCP lets Claude read and act on external systems instead of you pasting data in.

```bash
claude mcp add --transport http <name> <url>
claude mcp add --transport stdio <name> -- npx -y <package>
claude mcp list
/mcp                       # status inside a session
```

Scopes: `local` (default, private), `--scope project` (writes `.mcp.json`, shared via git),
`--scope user` (all your projects).

**The one that matters most for a website:**

| Connector | What it unlocks | Cost |
|---|---|---|
| [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Claude opens a real browser, reads the console, inspects network, profiles performance | ~5–6k tokens |
| Playwright MCP | Drives the browser, fills forms, takes screenshots; uses accessibility-tree snapshots (2–5KB) rather than images (500KB+) | ~5k tokens |
| **Figma** (you already have this) | Reads real design tokens and component names, so Claude stops inventing duplicates |  |
| shadcn/ui MCP | Fetches real component source instead of hand-rolling from memory |  |

**A real warning from the community toolkit:** MCP servers can consume ~55k tokens of context before
you type anything. Turn off the ones you are not using this session. Browser access is worth its cost;
five idle connectors are not.

Rough division of labour: **Playwright to drive, Chrome DevTools to debug.**

### 2.4 Prompts

The pattern that consistently works, in order:

1. **`/init`** — writes a `CLAUDE.md` describing the repo. Do this first; it is the memory every
   later session inherits.
2. **Plan mode before anything structural.** Ask for the plan, read it, correct the wrong assumption
   *before* 30 files exist.
3. **Anti-generic prompt.** State the aesthetic and forbid the defaults:

   > Build the product page. Aesthetic: warm, high-contrast editorial — think a Colombo boutique
   > lookbook, not a SaaS dashboard. Real product photos at full bleed. No purple gradients, no glass
   > morphism, no emoji headings, no rounded-everything. Sinhala and English must both look
   > deliberate, not bolted on. Show me one section first and stop.

4. **"Show me one, then stop."** Review a single component before it generates twenty.
5. **Paste a screenshot as the target.** Claude Code accepts pasted images. A reference screenshot
   beats three paragraphs of description.
6. **Make it look at its own work**: *"Screenshot it at 390px, 768px and 1440px, then tell me what
   looks wrong before I do."*

---

## 3. How to actually get something working and nice

This section is the one that matters, and it is drawn from what went wrong building the WhatsApp
agent in this same repo — not from theory.

### Give it eyes, or it is guessing

The agent worked perfectly in tests and broke in three separate ways the moment it touched real
WhatsApp: `@lid` identifiers instead of phone numbers, container-wrapped messages that vanished
silently, three processes fighting over one session. **None of that was findable without running it
for real.**

A website has exactly the same failure mode. Code that typechecks can still be ugly, misaligned,
unreadable on a phone, or slow. Claude cannot know unless it can see the rendered page — which is
what the browser MCP is for. Without it you are the render loop, and you will get bored before the
CSS is right.

### Write tests that can actually fail

During the CX work I wrote a check for "did it reply in Singlish?" that reported zero problems for
two full runs. The regex contained literal backspace bytes from a shell-escaping slip, so it matched
nothing and passed everything.

**A check that never fails is indistinguishable from a check that always passes.** Before trusting a
test, break the thing on purpose and confirm it goes red. For a website that means: delete a
required alt attribute, confirm the a11y check fails, put it back.

### Feed it real data, not idealised data

The photo fixtures were pristine 700KB renders. WhatsApp delivers 50–150KB after compression, so the
test was simultaneously more expensive and *less* faithful than production. Re-encoding to
WhatsApp quality made it both cheaper and more realistic.

For the site: build against your **real catalog and real photos** from day one. A page that looks
beautiful with three perfect products often falls apart with a 7-word Sinhala product name, a
missing photo, and an out-of-stock badge.

### Small increments, verified, pushed

Every time I batched several changes, a mistake hid inside the batch — the Python escaping bug bit
three separate times because it was buried in a larger edit. The sequence that worked:

```
one change  →  typecheck  →  test  →  look at the result  →  commit  →  push
```

Ask Claude to push at each milestone. When something breaks you can `git diff` one commit instead of
bisecting a day's work.

### Let it disagree with you

Twice today the useful move was pushing back rather than complying:
generating labelled photos instead of scraping unlabelled ones, and questioning whether Baileys was
the right channel at all. Ask *"what's wrong with this approach?"* before *"build it."*

### Correct the cause, not the symptom

When the agent ignored "how do I order?" and asked for a size instead, the fix was not to edit that
one reply. The cause was an earlier prompt rule — "never re-ask what you already know" — that had
quietly overridden answering the question. One rule fixed it for every future conversation.

The same applies to CSS. If a component is misaligned, fix the spacing scale, not that component.

---

## 4. A concrete plan for this site

**Stack:** Astro or Next.js static export + Tailwind v4, deployed on Cloudflare Pages or Vercel free
tier. Static, because a catalog site has no reason to run a server — and nothing to hack.

| Step | What | How you'll know it worked |
|---|---|---|
| 1 | `/init`, then a `brand` skill with colours, type, tone, bilingual rules | Two sessions produce the same look |
| 2 | Add `chrome-devtools-mcp` | Claude can screenshot its own output |
| 3 | Catalog data layer reading the **existing** `data/catalog.json` | Editing the JSON changes the site |
| 4 | One product card, reviewed before anything else is built | You actually like it |
| 5 | Product grid, product page, about, delivery & returns | Works at 390px |
| 6 | WhatsApp deep links with the product pre-filled | Tapping it opens WhatsApp with a real message |
| 7 | Sinhala/English toggle | Sinhala is not an afterthought |
| 8 | Lighthouse pass, real-device check | Loads fast on 3G |

**Two things to decide before starting:**

- **Domain.** A `.lk` domain signals a real Sri Lankan business far better than a free subdomain.
- **Photos.** The generated ones in `data/product-photos/` are fine for testing, but a shop's website
  needs photographs of the actual garments. This is the one part Claude Code cannot do for you, and
  it is the part customers judge you on.

---

## 5. Honest limits

- **Claude Code is good at structure, average at taste.** It produces clean, working, responsive code.
  Making it *nice* still requires you to say "no, warmer", "no, less rounded", repeatedly. The
  frontend-design skill narrows the gap; it does not close it.
- **Community skills vary wildly.** The starred repos are worth mining, but read a skill before
  installing it — it is instructions that will run in your sessions.
- **MCP servers are a context tax.** Enable what you are using today.
- **This guide's Claude Code details are from the official docs** (skills, subagents, MCP) and were
  checked on 2026-09-13. The design tactics come from community sources and my own experience in this
  repo, and are opinions, not documentation.
