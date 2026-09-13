/** A photo or voice note the customer sent, already downloaded. */
export type Attachment = {
  kind: "image" | "audio";
  /** IANA type, e.g. image/jpeg or audio/ogg. WhatsApp voice notes are ogg/opus. */
  mimeType: string;
  data: Buffer;
  /** True for a push-to-talk voice note, as opposed to a shared audio file. */
  isVoiceNote?: boolean;
  seconds?: number;
};

export type InboundMessage = {
  /** WhatsApp JID, e.g. 94771234567@s.whatsapp.net (or ...@lid on Baileys 7) */
  jid: string;
  text: string;
  /** Real phone digits, resolved from a @lid where possible. */
  phone?: string;
  pushName?: string;
  waMessageId?: string;
  /** Photos and voice notes. Empty or absent for a plain text message. */
  media?: Attachment[];
  /**
   * True when the shop's own account sent this - i.e. the owner typed a reply
   * on their phone rather than through the bot. The pipeline records these so
   * the model does not contradict a human who has already answered.
   * Messages the bot itself sent are filtered out by the channel.
   */
  fromMe?: boolean;
};

export type MessageHandler = (message: InboundMessage) => Promise<void>;

/**
 * The only thing the pipeline knows about WhatsApp. Baileys today,
 * the Meta Cloud API later - one new file, nothing else changes.
 */
export interface Channel {
  readonly name: string;
  start(onMessage: MessageHandler): Promise<void>;
  send(jid: string, text: string): Promise<void>;
  stop(): Promise<void>;
  /**
   * Every identity that counts as the operator, including any @lid the channel
   * resolved after connecting. Falls back to config when not implemented.
   */
  operatorIdentities?(): string[];
}
