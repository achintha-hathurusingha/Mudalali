import readline from "node:readline/promises";
import { config } from "../config.js";
import type { Channel, MessageHandler } from "./types.js";

/**
 * Local dev channel: type customer messages in the terminal, see what the
 * pipeline would send. Prefix a line with `me:` to speak as the operator.
 */
export class ConsoleChannel implements Channel {
  readonly name = "console";
  private rl: readline.Interface | null = null;
  private readonly customerJid = "94770000000@s.whatsapp.net";

  async start(onMessage: MessageHandler): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    this.rl = rl;

    console.log("Console channel. Type a customer message, or `me: <command>` to act as the operator. Ctrl+C to quit.\n");

    void (async () => {
      while (this.rl) {
        const line = await rl.question("customer> ");
        if (!line.trim()) continue;
        const asOperator = line.startsWith("me:");
        await onMessage({
          jid: asOperator ? config.operatorJid : this.customerJid,
          text: asOperator ? line.slice(3).trim() : line.trim(),
          pushName: "Test Customer",
        });
      }
    })();
  }

  async send(jid: string, text: string): Promise<void> {
    const who = jid === config.operatorJid ? "to you" : `to ${jid.split("@")[0]}`;
    console.log(`\n--- ${who} ---\n${text}\n`);
  }

  async stop(): Promise<void> {
    this.rl?.close();
    this.rl = null;
  }
}
