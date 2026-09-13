/**
 * Builds the labelled photo set the vision test scores against.
 *
 *   npm run photos          # generate anything missing
 *   npm run photos -- --force
 *
 * Labels live in data/photo-testset.json. They are generated rather than
 * scraped so the label is known by construction - a scraped photo has to be
 * hand-checked, and a wrong label silently corrupts every later measurement.
 * The prompts deliberately include worn, crumpled, badly lit and awkwardly
 * angled shots, because a set of clean product photos would flatter the model.
 */
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { mkdirSync, writeFileSync, existsSync, readFileSync, statSync } from "node:fs";
import sharp from "sharp";

type Labelled = { file: string; prompt: string; expectProductId: string | null };

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const dir = "./tests/fixtures/photos";
mkdirSync(dir, { recursive: true });

const set: Labelled[] = JSON.parse(readFileSync("./data/photo-testset.json", "utf8"));
const force = process.argv.includes("--force");

function firstImage(response: unknown): string | null {
  const parts =
    (response as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> })
      .candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const inline = part["inlineData"] as { data?: string } | undefined;
    if (inline?.data) return inline.data;
  }
  return null;
}

let made = 0;
let skipped = 0;
const failed: string[] = [];

for (const item of set) {
  const path = `${dir}/${item.file}`;
  if (existsSync(path) && !force) {
    skipped++;
    continue;
  }

  let data: string | null = null;
  // The image models intermittently return no candidate at all; retry rather
  // than leaving a hole in the set.
  for (let attempt = 1; attempt <= 3 && !data; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-image",
        contents: item.prompt,
        config: { responseModalities: ["IMAGE"] },
      });
      data = firstImage(response);
      if (!data) console.log(`  ${item.file}: attempt ${attempt} returned no image, retrying`);
    } catch (error) {
      console.log(`  ${item.file}: attempt ${attempt} failed - ${(error as Error).message.slice(0, 80)}`);
    }
  }

  if (!data) {
    failed.push(item.file);
    continue;
  }
  // Re-encode the way WhatsApp would before delivery: a pristine 700 KB render
  // is not what the bot ever receives, and costs more to test with.
  const compressed = await sharp(Buffer.from(data, "base64"))
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();
  writeFileSync(path, compressed);
  made++;
  console.log(`  ${item.file}  (${Math.round(statSync(path).size / 1024)} KB)`);
}

console.log(`\ngenerated ${made}, already present ${skipped}, failed ${failed.length}`);
if (failed.length) console.log("failed:", failed.join(", "));
