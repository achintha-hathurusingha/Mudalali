/**
 * Scores the labelled photo set: 20 images, each sent as a customer would send
 * it - with "meka thiyanawada?" and nothing else.
 *
 *   npm run photos       # once, to generate tests/fixtures/photos/
 *   npm run test:photos
 *
 * What is being measured is what the CUSTOMER sees, not internal fields. The
 * prompt deliberately forbids binding a product from a photo alone, so
 * entities.items is empty by design - the reply naming the right item is the
 * signal that matters.
 */
import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { createUnderstander } from "../src/understanding/index.js";
import type { Attachment } from "../src/channel/types.js";
import type { Product } from "../src/knowledge/catalog.js";
import type { Understanding } from "../src/understanding/schema.js";
import { closeDb } from "../src/memory/db.js";

type Labelled = {
  file: string;
  expectProductId: string | null;
  expectColour: string | null;
  condition: string;
  shouldEscalate: boolean;
};

const products: Product[] = JSON.parse(readFileSync("./data/catalog.json", "utf8"));
const set: Labelled[] = JSON.parse(readFileSync("./data/photo-testset.json", "utf8"));
const understander = createUnderstander();
const DIR = "./tests/fixtures/photos";

if (!existsSync(DIR)) {
  console.error("No photos. Run `npm run photos` first.");
  process.exit(1);
}

const legalPrices = new Set<number>();
for (const p of products) {
  for (const fee of [0, 350, 450]) for (let q = 1; q <= 5; q++) legalPrices.add(p.priceLkr * q + fee);
  legalPrices.add(p.priceLkr);
}

type Row = {
  file: string;
  condition: string;
  expected: string;
  gotProduct: boolean;
  gotColour: boolean;
  escalated: boolean;
  correct: boolean;
  note: string;
  reply: string;
  summary: string;
};

const rows: Row[] = [];

for (const item of set) {
  const path = `${DIR}/${item.file}`;
  if (!existsSync(path)) {
    console.log(`missing: ${item.file}`);
    continue;
  }
  const media: Attachment[] = [{ kind: "image", mimeType: "image/jpeg", data: readFileSync(path) }];

  let u: Understanding;
  try {
    const r = await understander.understand({
      history: [],
      message: "meka thiyanawada?",
      media,
      products,
    });
    u = r.understanding;
  } catch (error) {
    rows.push({
      file: item.file, condition: item.condition, expected: item.expectProductId ?? "none",
      gotProduct: false, gotColour: false, escalated: false, correct: false,
      note: `threw: ${(error as Error).message.slice(0, 50)}`, reply: "", summary: "",
    });
    continue;
  }

  const reply = u.draftReply;
  const summary = u.mediaSummary ?? "";
  const expected = products.find((p) => p.id === item.expectProductId);

  // Did the reply actually name the right item to the customer?
  const gotProduct = expected
    ? reply.toLowerCase().includes(expected.name.toLowerCase()) ||
      reply.includes(String(expected.priceLkr)) ||
      reply.includes(expected.priceLkr.toLocaleString("en-US"))
    : false;
  const gotColour = item.expectColour
    ? summary.toLowerCase().includes(item.expectColour.toLowerCase())
    : true;

  const bogus = [...reply.matchAll(/(?:rs\.?|රු\.?)\s*([\d,]+)/gi)]
    .map((m) => Number(m[1]!.replace(/,/g, "")))
    .filter((n) => !legalPrices.has(n));

  let correct: boolean;
  let note = "";

  if (item.shouldEscalate) {
    correct = u.needsHuman;
    note = correct ? "refused, as it should" : "did NOT escalate something we do not sell";
  } else {
    correct = gotProduct;
    note = correct ? "" : "reply did not name the right product";
    if (item.condition.includes("OUT OF STOCK")) {
      const saysOut = /out of stock|stock na|nathi|නැ|ඉවර|hamba|available na/i.test(reply);
      if (!saysOut) {
        correct = false;
        note = "did not say the item is out of stock";
      } else if (correct) {
        note = "named it and flagged the stockout";
      }
    }
  }
  if (bogus.length) {
    correct = false;
    note = `invented a price: Rs. ${bogus.join(", Rs. ")}`;
  }

  rows.push({
    file: item.file,
    condition: item.condition,
    expected: item.expectProductId ?? "not in catalog",
    gotProduct,
    gotColour,
    escalated: u.needsHuman,
    correct,
    note,
    reply,
    summary,
  });

  const mark = correct ? "OK" : "XX";
  console.log(`${mark} ${item.file}`);
  console.log(`   saw    : ${summary.slice(0, 95)}`);
  console.log(`   reply  : ${reply.slice(0, 95)}`);
  if (note) console.log(`   ${note}`);
}

// ---------------------------------------------------------------- summary

const positives = rows.filter((r) => r.expected !== "not in catalog");
const negatives = rows.filter((r) => r.expected === "not in catalog");
const colourScored = positives.filter((r) => r.gotColour);

console.log(`\n${"=".repeat(70)}`);
console.log(`in-catalog photos  : ${positives.filter((r) => r.correct).length}/${positives.length} named correctly`);
console.log(`colour described   : ${colourScored.length}/${positives.length}`);
console.log(`not-in-catalog     : ${negatives.filter((r) => r.correct).length}/${negatives.length} correctly refused`);
console.log(`overall            : ${rows.filter((r) => r.correct).length}/${rows.length}`);

const wrong = rows.filter((r) => !r.correct);
if (wrong.length) {
  console.log(`\nfailures:`);
  for (const r of wrong) console.log(`  ${r.file}  (${r.condition})\n    ${r.note}\n    reply: ${r.reply.slice(0, 90)}`);
}

await closeDb();
