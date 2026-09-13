import type { Product } from "../knowledge/catalog.js";
import type { Understanding } from "./schema.js";

export type Turn = { role: "customer" | "shop"; text: string };

export type UnderstandInput = {
  /** Oldest first. The pipeline passes the last N turns of this conversation. */
  history: Turn[];
  /** The new message, verbatim. */
  message: string;
  products: Product[];
};

export type UnderstandResult = {
  understanding: Understanding;
  model: string;
  latencyMs: number;
};

/**
 * The Understanding layer's port. One call in, one structured object out.
 * Swap the implementation without the pipeline noticing.
 */
export interface Understander {
  readonly name: string;
  understand(input: UnderstandInput): Promise<UnderstandResult>;
}
