import { readFileSync } from "node:fs";
import { newDb } from "pg-mem";
import type pg from "pg";
import { setPool } from "../src/memory/db.js";
import type { Channel, MessageHandler } from "../src/channel/types.js";
import type { Understander, UnderstandInput, UnderstandResult } from "../src/understanding/types.js";
import type { Understanding } from "../src/understanding/schema.js";

/** A real Postgres engine in memory: the SQL is executed, not mocked. */
export async function useTestDb(): Promise<void> {
  const db = newDb();
  db.public.none(readFileSync("./db/schema.sql", "utf8"));

  const products = JSON.parse(readFileSync("./data/catalog.json", "utf8")) as Array<{
    id: string; name: string; nameSi: string; priceLkr: number;
    sizes: string[]; colours: string[]; stock: number; active: boolean;
  }>;
  for (const p of products) {
    db.public.none(
      `insert into catalog (id, name, name_si, price_lkr, sizes, colours, stock, active)
       values (${esc(p.id)}, ${esc(p.name)}, ${esc(p.nameSi)}, ${p.priceLkr},
               array[${p.sizes.map(esc).join(",")}]::text[],
               array[${p.colours.map(esc).join(",")}]::text[],
               ${p.stock}, ${p.active})`,
    );
  }

  const { Pool } = db.adapters.createPg();
  setPool(new Pool() as pg.Pool);
}

function esc(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

export type Sent = { jid: string; text: string };

export class FakeChannel implements Channel {
  readonly name = "fake";
  readonly sent: Sent[] = [];

  async start(_onMessage: MessageHandler): Promise<void> {}
  async send(jid: string, text: string): Promise<void> {
    this.sent.push({ jid, text });
  }
  async stop(): Promise<void> {}

  to(jid: string): Sent[] {
    return this.sent.filter((s) => s.jid === jid);
  }
  clear(): void {
    this.sent.length = 0;
  }
}

/** Deterministic stand-in for the model, so code paths are tested without the network. */
export class StubUnderstander implements Understander {
  readonly name = "stub";
  calls = 0;
  constructor(private readonly reply: (input: UnderstandInput) => Partial<Understanding>) {}

  async understand(input: UnderstandInput): Promise<UnderstandResult> {
    this.calls++;
    return {
      understanding: { ...baseUnderstanding, ...this.reply(input) },
      model: "stub",
      latencyMs: 1,
    };
  }
}

export const baseUnderstanding: Understanding = {
  language: "singlish",
  intent: "availability",
  confidence: 0.95,
  entities: {
    items: [],
    customerName: null,
    phone: null,
    addressLine: null,
    city: null,
    refersToEarlier: false,
  },
  orderReady: false,
  missingFields: [],
  needsHuman: false,
  needsHumanReason: null,
  draftReply: "Ow thiyenawa.",
};

/** Pull the 4-char draft code out of an operator notification. */
export function draftCode(text: string): string {
  const m = /^\[([a-z0-9]{4})\]/.exec(text);
  if (!m) throw new Error(`no draft code in: ${text.slice(0, 80)}`);
  return m[1]!;
}
