// Offline sanity check: no DB, no API key, no network.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { UnderstandingSchema } from "../src/understanding/schema.js";
import { buildSystemPrompt } from "../src/understanding/prompt.js";
import { renderCatalog, type Product } from "../src/knowledge/catalog.js";
import { deliveryFeeFor } from "../src/knowledge/business.js";
import { closeDb } from "../src/memory/db.js";

const products: Product[] = JSON.parse(readFileSync("./data/catalog.json", "utf8"));

const jsonSchema = z.toJSONSchema(UnderstandingSchema, { io: "output" }) as Record<string, unknown>;
console.log("JSON schema top-level keys:", Object.keys(jsonSchema).join(", "));
console.log("contains $ref (Gemini rejects these):", JSON.stringify(jsonSchema).includes('"$ref"'));
console.log("required fields:", (jsonSchema["required"] as string[]).join(", "));

const prompt = buildSystemPrompt(products);
console.log("\nsystem prompt chars:", prompt.length);
console.log("catalog block present:", prompt.includes("TS-001"));
console.log("out-of-stock flagged:", renderCatalog(products).includes("OUT OF STOCK"));

console.log("\ndelivery Colombo  (items Rs 1890):", deliveryFeeFor("Colombo", 1890));
console.log("delivery Jaffna   (items Rs 1890):", deliveryFeeFor("Jaffna", 1890));
console.log("delivery Jaffna   (items Rs 12000):", deliveryFeeFor("Jaffna", 12000));

const sample = {
  language: "singlish",
  intent: "availability",
  confidence: 0.93,
  entities: {
    productId: "TS-001",
    productName: "T shirt",
    size: null,
    colour: null,
    quantity: null,
    city: null,
    refersToEarlier: false,
  },
  orderReady: false,
  missingFields: ["size", "colour"],
  needsHuman: false,
  needsHumanReason: null,
  draftReply: "Ow, thiyenawa! Mona size ekada oney?",
};
const parsed = UnderstandingSchema.safeParse(sample);
console.log("\nsample response parses:", parsed.success);
if (!parsed.success) console.log(parsed.error.issues);

await closeDb();
