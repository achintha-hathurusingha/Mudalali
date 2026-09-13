export type InboundMessage = {
  /** WhatsApp JID, e.g. 94771234567@s.whatsapp.net (or ...@lid on Baileys 7) */
  jid: string;
  text: string;
  pushName?: string;
  waMessageId?: string;
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
}
