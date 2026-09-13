import { z } from "zod";

/**
 * The one contract between the messy world and the rest of the pipeline.
 * Both the Gemini and Claude adapters return exactly this.
 */

export const INTENTS = [
  "greeting",
  "availability",
  "price",
  "variant",
  "place_order",
  "delivery",
  "payment",
  "order_status",
  "complaint_return",
  "bargaining",
  "other",
] as const;

export type Intent = (typeof INTENTS)[number];

/** One line of an order. A customer buying two things produces two of these. */
export const OrderItemSchema = z.object({
  productId: z
    .string()
    .nullable()
    .describe("Catalog id of the product, e.g. 'TS-001'. Null if you cannot identify it with certainty."),
  productName: z.string().nullable().describe("How the customer named it, in their own words."),
  size: z.string().nullable().describe("Size, normalised to the catalog's format (S, M, L, XL, 30, 32...)."),
  colour: z.string().nullable().describe("Colour in English, matching the catalog spelling."),
  quantity: z.number().int().nullable().describe("How many units of this item. Null if not stated."),
});

export const EntitiesSchema = z.object({
  items: z
    .array(OrderItemSchema)
    .describe(
      "Every distinct product in play, one entry each. Empty when no product is identifiable. " +
        "A customer asking for two t-shirts and a dress produces two entries.",
    ),
  customerName: z.string().nullable().describe("Customer's name if they gave it."),
  phone: z.string().nullable().describe("Contact phone number if they gave one, digits only."),
  addressLine: z
    .string()
    .nullable()
    .describe("Street address without the city, e.g. '45/2 Temple Road'. Null if not given."),
  city: z
    .string()
    .nullable()
    .describe(
      "Delivery city or town in English, normalised to its common full spelling: " +
        "'Colombo 07' and 'Col 3' both become 'Colombo'; 'Mt Lavinia' becomes 'Mount Lavinia'.",
    ),
  refersToEarlier: z
    .boolean()
    .describe(
      "True when the message only makes sense against earlier turns - 'eka', 'ekak', 'meka', 'ow', 'hari', 'same one'.",
    ),
});

export const UnderstandingSchema = z.object({
  language: z
    .enum(["sinhala_script", "singlish", "english", "tamil", "mixed"])
    .describe("Script and language the customer wrote in. Your reply must match it."),
  intent: z.enum(INTENTS).describe("The single best intent for the LATEST customer message."),
  confidence: z.number().min(0).max(1).describe("How sure you are of the intent, 0 to 1."),
  entities: EntitiesSchema,
  orderReady: z
    .boolean()
    .describe(
      "True only when every item has a product, size and colour the catalog offers, a quantity, " +
        "and the customer has actually said they want it. Browsing is not ordering.",
    ),
  missingFields: z
    .array(z.string())
    .describe("Which of product, size, colour, quantity, name, phone, address, city are still needed."),
  needsHuman: z.boolean().describe("True when a person must handle this - see the escalation rules."),
  needsHumanReason: z.string().nullable().describe("One short line explaining why, for the operator. Null if not needed."),
  draftReply: z
    .string()
    .describe("The reply to send the customer, in their own language and script. Short, warm, WhatsApp-length."),
  mediaSummary: z
    .string()
    .nullable()
    .describe(
      "Only when the customer sent a photo or voice note. For a voice note: the transcript, " +
        "in the customer's own language and script. For a photo: a short factual description of " +
        "what is in it. Null when no media was sent. This is what gets stored - the bytes are not kept.",
    ),
});

export type Understanding = z.infer<typeof UnderstandingSchema>;
export type Entities = z.infer<typeof EntitiesSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;

/** The first identifiable product, for the common single-item case. */
export function primaryItem(u: Understanding): OrderItem | null {
  return u.entities.items.find((i) => i.productId) ?? u.entities.items[0] ?? null;
}
