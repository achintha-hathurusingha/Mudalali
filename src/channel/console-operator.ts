import readline from "node:readline";
import { existsSync, statSync, createReadStream, writeFileSync } from "node:fs";
import { config } from "../config.js";
import { log } from "../log.js";
import { isOperator } from "../util/jid.js";
import type { Channel, MessageHandler } from "./types.js";

const COMMAND_FILE = process.env.OPERATOR_COMMAND_FILE ?? "./operator-commands.txt";
const NEWLINE = /\r?\n/;

/**
 * Wraps a real channel so the operator side runs in the terminal instead of
 * over WhatsApp. Drafts print here, approvals are typed here.
 *
 * Two reasons this exists:
 *  - Testing needs three roles (agent, customer, operator) and most people have
 *    two phones. This frees one.
 *  - It avoids the bot messaging its own number, which is the one unusual thing
 *    a single-number setup does on the wire.
 *
 * Enable with OPERATOR_CONSOLE=true. Commands can be typed on stdin, or
 * appended to ./operator-commands.txt - which is what makes this usable while
 * the agent runs as a background process.
 */
export class ConsoleOperatorChannel implements Channel {
  readonly name: string;
  private rl: readline.Interface | null = null;
  private watcher: NodeJS.Timeout | null = null;
  private offset = 0;

  constructor(private readonly inner: Channel) {
    this.name = `${inner.name}+console-operator`;
  }

  async start(onMessage: MessageHandler): Promise<void> {
    await this.inner.start(onMessage);

    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    this.rl = rl;
    log.info("operator console ready - ok <code> | <code> <text> | skip <code> | pending | help");

    rl.on("line", (line) => this.dispatch(line, onMessage));
    this.watchCommandFile(onMessage);
  }

  /** Tail a file so commands can be appended from another terminal. */
  private watchCommandFile(onMessage: MessageHandler): void {
    if (!existsSync(COMMAND_FILE)) writeFileSync(COMMAND_FILE, "");
    this.offset = statSync(COMMAND_FILE).size;
    log.info({ file: COMMAND_FILE }, "append operator commands here, one per line");

    this.watcher = setInterval(() => {
      let size: number;
      try {
        size = statSync(COMMAND_FILE).size;
      } catch {
        return;
      }
      if (size <= this.offset) {
        this.offset = size; // the file was truncated or replaced
        return;
      }

      const stream = createReadStream(COMMAND_FILE, {
        start: this.offset,
        end: size - 1,
        encoding: "utf8",
      });
      this.offset = size;

      let buffer = "";
      stream.on("data", (chunk) => (buffer += chunk));
      stream.on("end", () => {
        for (const line of buffer.split(NEWLINE)) this.dispatch(line, onMessage);
      });
      stream.on("error", (err) => log.debug({ err }, "could not read the command file"));
    }, 1000);
  }

  private dispatch(line: string, onMessage: MessageHandler): void {
    const text = line.trim();
    if (!text) return;
    void onMessage({ jid: config.operatorJid, text }).catch((err) =>
      log.error({ err }, "operator command failed"),
    );
  }

  async send(jid: string, text: string): Promise<void> {
    if (isOperator(jid, this.operatorIdentities())) {
      process.stdout.write(`\n${"-".repeat(60)}\n${text}\n${"-".repeat(60)}\n`);
      return;
    }
    await this.inner.send(jid, text);
  }

  async sendImage(jid: string, filePath: string, caption?: string): Promise<void> {
    if (isOperator(jid, this.operatorIdentities())) {
      process.stdout.write(`\n[photo to you] ${filePath}${caption ? ` - ${caption}` : ""}\n`);
      return;
    }
    if (!this.inner.sendImage) throw new Error(`${this.inner.name} cannot send photos`);
    await this.inner.sendImage(jid, filePath, caption);
  }

  async stop(): Promise<void> {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = null;
    this.rl?.close();
    this.rl = null;
    await this.inner.stop();
  }

  operatorIdentities(): string[] {
    return this.inner.operatorIdentities?.() ?? config.operatorJids;
  }
}
