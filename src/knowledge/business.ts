import { readFileSync } from "node:fs";
import { log } from "../log.js";

export type Business = {
  shopName: string;
  hours: string;
  delivery: {
    note: string;
    colomboAreaFeeLkr: number;
    outstationFeeLkr: number;
    freeAboveLkr: number;
    colomboAreaCities: string[];
    cityAliases: Record<string, string>;
  };
  payment: { cod: boolean; codNote: string; bankTransfer: boolean; bankDetails: string };
  returns: string;
  escalationPolicy: string;
};

export const business: Business = JSON.parse(readFileSync("./data/business.json", "utf8"));

/**
 * Sri Lankan addresses arrive as "Colombo 07", "Col 3", "Dehiwela", "Mt Lavinia".
 * An exact string match against the city list silently overcharges the customer
 * by Rs. 100 whenever the spelling differs, so normalise before pricing.
 */
export function canonicalCity(raw: string | null): string | null {
  if (!raw) return null;

  let city = raw
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // "colombo 07", "colombo-5", "col 3" all price as Colombo.
  city = city.replace(/^(colombo|col|cmb)\s*[-\s]?\s*\d{1,2}$/, "colombo");

  const alias = business.delivery.cityAliases[city];
  if (alias) return alias;

  if (business.delivery.colomboAreaCities.includes(city)) return city;

  // Last resort: a one- or two-character typo against a known city.
  const near = business.delivery.colomboAreaCities.find((known) => editDistance(city, known) <= 2);
  return near ?? city;
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const row = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = row[j]!;
  }
  return prev[b.length]!;
}

export function isColomboArea(city: string | null): boolean {
  const canonical = canonicalCity(city);
  return canonical !== null && business.delivery.colomboAreaCities.includes(canonical);
}

export function deliveryFeeFor(city: string | null, itemsTotalLkr: number): number {
  if (itemsTotalLkr >= business.delivery.freeAboveLkr) return 0;
  if (!city) return business.delivery.outstationFeeLkr;

  if (isColomboArea(city)) return business.delivery.colomboAreaFeeLkr;

  // Not recognised at all - it may be a genuine outstation town, or a spelling
  // the alias table has never seen. Say so, because the difference is money.
  log.warn({ city, canonical: canonicalCity(city) }, "city not in the Colombo fee list - charging outstation");
  return business.delivery.outstationFeeLkr;
}

export function renderBusiness(): string {
  const d = business.delivery;
  return [
    `Shop: ${business.shopName}`,
    `Hours: ${business.hours}`,
    `Delivery: ${d.note} Colombo area Rs. ${d.colomboAreaFeeLkr}, outstation Rs. ${d.outstationFeeLkr}. Free over Rs. ${d.freeAboveLkr}.`,
    `Payment: ${business.payment.codNote} Bank transfer: ${business.payment.bankDetails}`,
    `Returns: ${business.returns}`,
  ].join("\n");
}
