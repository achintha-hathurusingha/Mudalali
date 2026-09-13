/**
 * Run messages through the Understanding layer only - no WhatsApp, no DB writes.
 *
 *   npm run try                       # whole fixture set in data/testset.json
 *   npm run try -- "denim eka kiyada" # one ad-hoc message
 *
 * Switch provider with LLM_PROVIDER=claude to compare on the same fixtures.
 */
import { readFileSync } from "node:fs";
import { createUnderstander } from "../src/understanding/index.js";
import type { Turn } from "../src/understanding/types.js";
import type { Product } from "../src/knowledge/catalog.js";
import { closeDb } from "../src/memory/db.js";

type Fixture = { message: string; expectIntent?: string | string[]; history?: Turn[] };

const products: Product[] = JSON.parse(readFileSync("./data/catalog.json", "utf8"));
const adHoc = process.argv.slice(2).join(" ").trim();
const fixtures: Fixture[] = adHoc
  ? [{ message: adHoc }]
  : JSON.parse(readFileSync("./data/testset.json", "utf8"));

const understander = createUnderstander();
console.log(`provider: ${understander.name}  fixtures: ${fixtures.length}\n`);

let correct = 0;
let scored = 0;
let totalMs = 0;

for (const fixture of fixtures) {
  try {
    const { understanding: u, latencyMs } = await understander.understand({
      history: fixture.history ?? [],
      message: fixture.message,
      products,
    });
    totalMs += latencyMs;

    let mark = " ";
    const expected = fixture.expectIntent
      ? [fixture.expectIntent].flat()
      : null;
    if (expected) {
      scored++;
      const hit = expected.includes(u.intent);
      if (hit) correct++;
      mark = hit ? "OK" : "XX";
    }

    console.log(`${mark} "${fixture.message}"`);
    console.log(
      `   ${u.intent} ${u.confidence.toFixed(2)} | ${u.language}` +
        (expected && !expected.includes(u.intent) ? ` | expected ${expected.join(" or ")}` : "") +
        (u.needsHuman ? ` | HUMAN: ${u.needsHumanReason ?? ""}` : ""),
    );
    for (const item of u.entities.items) {
      const parts = [item.productId, item.productName, item.size, item.colour, item.quantity]
        .filter((v) => v !== null && v !== undefined)
        .join(" / ");
      console.log(`   item: ${parts}`);
    }
    const { items: _items, refersToEarlier, ...rest } = u.entities;
    const filled: Array<[string, string]> = Object.entries(rest)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, String(v)]);
    if (refersToEarlier) filled.push(["refersToEarlier", "true"]);
    if (filled.length) console.log(`   ${filled.map(([k, v]) => `${k}=${v}`).join(" ")}`);
    console.log(`   -> ${u.draftReply}`);
    console.log(`   ${latencyMs}ms\n`);
  } catch (error) {
    console.log(`!! "${fixture.message}"\n   ${(error as Error).message}\n`);
  }
}

if (scored) console.log(`intent accuracy: ${correct}/${scored}`);
console.log(`mean latency: ${Math.round(totalMs / fixtures.length)}ms`);

await closeDb();
