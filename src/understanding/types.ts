import type { Product } from "../knowledge/catalog.js";
import type { Attachment } from "../channel/types.js";
import type { Understanding } from "./schema.js";

export type Turn = { role: "customer" | "shop"; text: string };

export type UnderstandInput = {
  /** Oldest first. The pipeline passes the last N turns of this conversation. */
  history: Turn[];
  /** The new message, verbatim. May be empty when only media was sent. */
  message: string;
  /** Photos and voice notes attached to the new message. */
  media?: Attachment[];
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
/**
 * What a provider can actually read. Declared rather than assumed: Claude has
 * no audio content block, so a voice note must reach a human instead of being
 * silently dropped.
 */
export type Capabilities = { image: boolean; audio: boolean };

export interface Understander {
  readonly name: string;
  readonly capabilities: Capabilities;
  understand(input: UnderstandInput): Promise<UnderstandResult>;
}
