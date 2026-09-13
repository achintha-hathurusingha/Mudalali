/**
 * Live media test: real photos and a real voice note through the real model.
 *
 *   npm run fixtures     # once, to generate tests/fixtures/
 *   npm run test:media
 *
 * Costs real API calls. Audio requires a provider that can hear - Gemini can,
 * Claude cannot, and the test says so rather than pretending.
 */
import { readFileSync, existsSync } from "node:fs";
import { createUnderstander } from "../src/understanding/index.js";
import type { Attachment } from "../src/channel/types.js";
import type { Product } from "../src/knowledge/catalog.js";
import type { Understanding } from "../src/understanding/schema.js";
import { closeDb } from "../src/memory/db.js";

const products: Product[] = JSON.parse(readFileSync("./data/catalog.json", "utf8"));
const understander = createUnderstander();

const FIXTURES = "./tests/fixtures";
if (!existsSync(`${FIXTURES}/black-tshirt.jpg`)) {
  console.error("No fixtures. Run `npm run fixtures` first.");
  process.exit(1);
}

function image(name: string): Attachment {
  return { kind: "image", mimeType: "image/jpeg", data: readFileSync(`${FIXTURES}/${name}`) };
}
function voice(name: string): Attachment {
  return {
    kind: "audio",
    mimeType: "audio/wav",
    data: readFileSync(`${FIXTURES}/${name}`),
    isVoiceNote: true,
  };
}

type Check = (u: Understanding) => string | null;

const failures: string[] = [];

async function scenario(name: string, why: string, input: { text: string; media: Attachment[] }, checks: Check[]) {
  console.log(`\n### ${name}`);
  console.log(`  ${why}`);
  const kinds = input.media.map((m) => m.kind).join(", ");
  console.log(`  customer: ${input.text || "(no text)"}  [${kinds}, ${Math.round(input.media[0]!.data.length / 1024)} KB]`);

  let u: Understanding;
  const started = Date.now();
  try {
    const r = await understander.understand({ history: [], message: input.text, media: input.media, products });
    u = r.understanding;
  } catch (error) {
    const problem = `threw: ${(error as Error).message}`;
    console.log(`  !! ${problem}`);
    failures.push(`[${name}] ${problem}`);
    return;
  }

  console.log(`  read as : ${u.mediaSummary ?? "(nothing)"}`);
  console.log(`  intent  : ${u.intent} ${u.confidence.toFixed(2)}${u.needsHuman ? " HUMAN" : ""}`);
  console.log(`  items   : ${u.entities.items.map((i) => `${i.productId ?? "?"}/${i.size ?? "-"}/${i.colour ?? "-"}`).join(" ") || "(none)"}`);
  console.log(`  reply   : ${u.draftReply}`);
  console.log(`  ${Date.now() - started}ms`);

  for (const check of checks) {
    const problem = check(u);
    if (problem) {
      console.log(`  >> ${problem}`);
      failures.push(`[${name}] ${problem}`);
    }
  }
}

const summaryMentions =
  (...words: string[]): Check =>
  (u) => {
    const text = (u.mediaSummary ?? "").toLowerCase();
    const missing = words.filter((w) => !text.includes(w.toLowerCase()));
    return missing.length ? `summary did not mention ${missing.join(", ")}: "${u.mediaSummary}"` : null;
  };

const replyMentions =
  (...words: string[]): Check =>
  (u) => {
    const text = u.draftReply.toLowerCase();
    return words.some((w) => text.includes(w.toLowerCase()))
      ? null
      : `reply never mentioned ${words.join(" or ")}: "${u.draftReply}"`;
  };

/** Spelling in a transcript is arbitrary - match on shape, not on a literal. */
const summaryMatches =
  (pattern: RegExp, label: string): Check =>
  (u) =>
    pattern.test(u.mediaSummary ?? "") ? null : `summary did not mention ${label}: "${u.mediaSummary}"`;

const noItemsYet: Check = (u) =>
  u.entities.items.some((i) => i.productId)
    ? "bound a product from a photo alone - it must be confirmed in words first"
    : null;

const asksToConfirm: Check = (u) =>
  /[?？]/.test(u.draftReply) ? null : "did not ask the customer to confirm the match";

const mustEscalate: Check = (u) => (u.needsHuman ? null : "should have gone to a human but did not");

const SINGLISH = /\b(thiyan|thiyen|oney|oni|ona|ekak|eka|mata|karanna|ow|puluwan|kiyada|meka|ape|oyaata|oyata)\b/i;

/** A caption-less photo carries no language signal; English is the wrong default here. */
const repliesInSinglish: Check = (u) =>
  SINGLISH.test(u.draftReply) ? null : `replied in English to a Sri Lankan shop's customer: "${u.draftReply}"`;

const intentIs =
  (...expected: string[]): Check =>
  (u) =>
    expected.includes(u.intent) ? null : `intent was ${u.intent}, expected ${expected.join(" or ")}`;

const itemMatches =
  (productId: string, size?: string, colour?: string): Check =>
  (u) => {
    const item = u.entities.items[0];
    if (!item) return "no item extracted";
    if (item.productId !== productId) return `productId was ${item.productId}, expected ${productId}`;
    if (size && item.size !== size) return `size was ${item.size}, expected ${size}`;
    if (colour && item.colour?.toLowerCase() !== colour.toLowerCase())
      return `colour was ${item.colour}, expected ${colour}`;
    return null;
  };

// ---------------------------------------------------------------- run

console.log(`provider: ${understander.name}  (image: ${understander.capabilities.image}, audio: ${understander.capabilities.audio})`);

await scenario(
  "photo of a product we sell",
  "a photo plus 'meka thiyanawada?' is a standard opening here",
  { text: "meka thiyanawada?", media: [image("black-tshirt.jpg")] },
  [
    summaryMentions("black"),
    replyMentions("Plain Cotton", "1890"),
    asksToConfirm,
    noItemsYet,
    intentIs("availability", "variant", "price"),
  ],
);

await scenario(
  "photo with no caption at all",
  "people often send just a picture and wait",
  { text: "", media: [image("black-tshirt.jpg")] },
  [summaryMentions("black"), asksToConfirm, noItemsYet, repliesInSinglish],
);

await scenario(
  "photo of something we do not sell",
  "inventing a product from a picture would be the worst possible failure",
  { text: "meka thiyanawada?", media: [image("running-shoes.jpg")] },
  [summaryMentions("shoe"), mustEscalate, noItemsYet],
);

if (understander.capabilities.audio) {
  const said = readFileSync(`${FIXTURES}/voice-order.txt`, "utf8").trim();
  await scenario(
    "voice note ordering a t-shirt",
    `what was actually said: "${said}"`,
    { text: "", media: [voice("voice-order.wav")] },
    [
      summaryMatches(/t[-\s]?shirt/i, "a t-shirt"),
      itemMatches("TS-001", "L", "Black"),
      intentIs("place_order", "price", "availability"),
      replyMentions("1890"),
    ],
  );
} else {
  console.log(`\n### voice note\n  skipped: ${understander.name} cannot hear audio`);
}

console.log(`\n${"=".repeat(66)}`);
console.log(failures.length ? `findings: ${failures.length}` : "findings: 0");
for (const f of failures) console.log(`- ${f}`);

await closeDb();
