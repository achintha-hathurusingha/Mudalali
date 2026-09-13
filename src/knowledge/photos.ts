import { readFileSync, existsSync } from "node:fs";
import { log } from "../log.js";

/** productId -> colour -> file path */
type PhotoIndex = Record<string, Record<string, string>>;

const index: PhotoIndex = JSON.parse(readFileSync("./data/product-photos.json", "utf8"));

export type ProductPhoto = { productId: string; colour: string; path: string };

/**
 * The photos a customer asked to see. A request with no colour returns every
 * colour we have - "thiyana colors okkoma danna" is a normal ask.
 */
export function photosFor(productId: string, colour: string | null): ProductPhoto[] {
  const byColour = index[productId];
  if (!byColour) return [];

  const wanted = colour
    ? Object.keys(byColour).filter((c) => c.toLowerCase() === colour.trim().toLowerCase())
    : Object.keys(byColour);

  const found: ProductPhoto[] = [];
  for (const c of wanted) {
    const path = byColour[c]!;
    if (existsSync(path)) found.push({ productId, colour: c, path });
    else log.warn({ productId, colour: c, path }, "catalog photo is missing from disk");
  }
  return found;
}

/** Which products we can show pictures of, for the prompt. */
export function productsWithPhotos(): string[] {
  return Object.keys(index);
}

export function renderPhotoAvailability(): string {
  return Object.entries(index)
    .map(([id, byColour]) => `  ${id}: ${Object.keys(byColour).join(", ")}`)
    .join("\n");
}
