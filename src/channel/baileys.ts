import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import { config } from "../config.js";
import { log, silentLogger } from "../log.js";
import type { Channel, MessageHandler } from "./types.js";

const MAX_BACKOFF_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 10;

/**
 * Unofficial WhatsApp Web client. Free and works on your existing number,
 * but it is against WhatsApp's terms - keep the Cloud API migration in view.
 */
export class BaileysChannel implements Channel {
  readonly name = "baileys";
  private socket: WASocket | null = null;
  private stopping = false;
  private failures = 0;
  /** Ids of messages this process sent, so they are not read back as human replies. */
  private readonly ownSends = new Set<string>();

  async start(onMessage: MessageHandler): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(config.waAuthDir);
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      logger: silentLogger,
      markOnlineOnConnect: false,
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);

    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        log.info("Scan this QR in WhatsApp > Linked devices");
        qrcode.generate(qr, { small: true });
      }
      if (connection === "open") {
        this.failures = 0;
        log.info({ me: socket.user?.id, lid: socket.user?.lid }, "WhatsApp connected");
      }
      if (connection === "close") {
        const status = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = status === DisconnectReason.loggedOut;
        log.warn({ status, loggedOut }, "WhatsApp connection closed");
        if (loggedOut || this.stopping) return;
        this.reconnect(onMessage);
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const message of messages) {
        const jid = message.key.remoteJid;
        if (!jid) continue;
        // Groups and status broadcasts are not customers.
        if (jid.endsWith("@g.us") || jid === "status@broadcast" || jid.endsWith("@newsletter")) continue;

        const id = message.key.id ?? undefined;
        // Our own outbound echoes back through this event; ignore those.
        if (id && this.ownSends.has(id)) {
          this.ownSends.delete(id);
          continue;
        }

        const text =
          message.message?.conversation ??
          message.message?.extendedTextMessage?.text ??
          message.message?.imageMessage?.caption ??
          message.message?.videoMessage?.caption ??
          "";
        if (!text.trim()) continue;

        try {
          await onMessage({
            jid,
            text: text.trim(),
            pushName: message.pushName ?? undefined,
            waMessageId: id,
            fromMe: Boolean(message.key.fromMe),
          });
        } catch (error) {
          log.error({ err: error, jid }, "handler threw");
        }
      }
    });
  }

  /** Exponential backoff: hammering the connection is how a number gets flagged. */
  private reconnect(onMessage: MessageHandler): void {
    this.failures++;
    if (this.failures > MAX_CONSECUTIVE_FAILURES) {
      log.error({ failures: this.failures }, "giving up reconnecting - restart the process");
      return;
    }
    const delay = Math.min(1000 * 2 ** (this.failures - 1), MAX_BACKOFF_MS);
    log.info({ attempt: this.failures, delayMs: delay }, "reconnecting");
    setTimeout(() => {
      if (!this.stopping) void this.start(onMessage).catch((err) => log.error({ err }, "reconnect failed"));
    }, delay);
  }

  async send(jid: string, text: string): Promise<void> {
    if (!this.socket) throw new Error("Channel not started");
    const sent = await this.socket.sendMessage(jid, { text });
    if (sent?.key.id) this.ownSends.add(sent.key.id);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.socket?.end(undefined);
    this.socket = null;
  }
}
