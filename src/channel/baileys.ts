import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  DisconnectReason,
  type WAMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import { readFileSync } from "node:fs";
import type { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";
import { config } from "../config.js";
import { log, silentLogger } from "../log.js";
import type { Attachment, Channel, MessageHandler } from "./types.js";

/**
 * Peels off the containers WhatsApp wraps real content in. Without this a photo
 * sent in a disappearing-messages chat, or as view-once, is never seen at all.
 */
function unwrap(message: proto.IMessage | null | undefined): proto.IMessage | null | undefined {
  let current = message;
  for (let depth = 0; depth < 4 && current; depth++) {
    const inner =
      current.ephemeralMessage?.message ??
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message ??
      current.documentWithCaptionMessage?.message ??
      current.editedMessage?.message;
    if (!inner) return current;
    current = inner;
  }
  return current;
}

const QR_IMAGE = "./wa-login-qr.png";
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
  private connected = false;
  private stableTimer: NodeJS.Timeout | null = null;
  private readonly recentOpens: number[] = [];
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
        log.info("Scan this QR in WhatsApp > Settings > Linked devices");
        qrcode.generate(qr, { small: true });
        // Terminal block characters are often unscannable; a PNG always works.
        void QRCode.toFile(QR_IMAGE, qr, { width: 512, margin: 2 })
          .then(() => log.info({ file: QR_IMAGE }, "QR also written as an image - open it and scan"))
          .catch((err) => log.warn({ err }, "could not write the QR image"));
      }
      if (connection === "open") {
        this.connected = true;
        // Only a connection that actually survives counts as recovery. Resetting
        // on every open lets a connect/close flap run forever.
        this.stableTimer = setTimeout(() => {
          this.failures = 0;
          this.recentOpens.length = 0;
        }, 30_000);
        this.recentOpens.push(Date.now());
        log.info({ me: socket.user?.id, lid: socket.user?.lid }, "WhatsApp connected");
        // WhatsApp now delivers most chats under @lid identifiers that are not
        // derived from the phone number. Learn the operator's LID so their
        // commands are recognised whichever form they arrive in.
        void this.learnOperatorLids(socket);
      }
      if (connection === "close") {
        this.connected = false;
        if (this.stableTimer) clearTimeout(this.stableTimer);
        this.stableTimer = null;
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

        // WhatsApp wraps content in containers - disappearing messages,
        // view-once, captioned documents. Reading only the top level makes
        // photos vanish with no log at all.
        const content = unwrap(message.message);

        const text =
          content?.conversation ??
          content?.extendedTextMessage?.text ??
          content?.imageMessage?.caption ??
          content?.videoMessage?.caption ??
          "";

        // A photo with no caption, or a voice note, is still a message.
        const media = await this.downloadMedia(message, content, socket);
        if (!text.trim() && media.length === 0) {
          // Never skip silently: an unrecognised type is how media disappears.
          const kinds = Object.keys(content ?? {}).filter((k) => k !== "messageContextInfo");
          if (kinds.length) log.warn({ jid, kinds }, "message type not handled");
          continue;
        }

        try {
          await onMessage({
            jid,
            phone: await this.phoneFor(jid, socket),
            text: text.trim(),
            media,
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

  /** The operator's phone JID plus whatever LID WhatsApp uses for them. */
  private async learnOperatorLids(socket: WASocket): Promise<void> {
    for (const jid of config.operatorJids) {
      if (jid.endsWith("@lid")) continue;
      try {
        const lid = await socket.signalRepository.lidMapping.getLIDForPN(jid);
        if (lid && !this.operatorLids.has(lid)) {
          this.operatorLids.add(lid);
          log.info({ jid, lid }, "learned the operator's LID");
        }
      } catch (error) {
        log.debug({ err: error, jid }, "could not resolve a LID for the operator");
      }
    }
    // The bot's own account is the operator in a single-number setup.
    if (socket.user?.lid) this.operatorLids.add(socket.user.lid);
  }

  /** Extra operator identities discovered at runtime. */
  private readonly operatorLids = new Set<string>();

  operatorIdentities(): string[] {
    return [...config.operatorJids, ...this.operatorLids];
  }

  /** A LID is not a phone number; look up the real one so `msg <phone>` works. */
  private async phoneFor(jid: string, socket: WASocket): Promise<string | undefined> {
    if (!jid.endsWith("@lid")) return jid.split("@")[0]?.split(":")[0];
    try {
      const pn = await socket.signalRepository.lidMapping.getPNForLID(jid);
      return pn ? (pn.split("@")[0]?.split(":")[0] ?? undefined) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Photos and voice notes arrive encrypted and have to be fetched. A failure
   * here returns nothing rather than throwing - the pipeline then hands the
   * customer to a human instead of losing them.
   */
  private async downloadMedia(
    message: WAMessage,
    content: proto.IMessage | null | undefined,
    socket: WASocket,
  ): Promise<Attachment[]> {
    const image = content?.imageMessage;
    const audio = content?.audioMessage;
    if (!image && !audio) return [];

    const kind = image ? ("image" as const) : ("audio" as const);
    const mimeType = (image?.mimetype ?? audio?.mimetype ?? "").split(";")[0] || "";
    const declaredSize = Number(image?.fileLength ?? audio?.fileLength ?? 0);

    if (declaredSize > config.maxMediaBytes) {
      log.warn({ kind, declaredSize }, "media larger than the cap, not downloading");
      return [{ kind, mimeType, data: Buffer.alloc(config.maxMediaBytes + 1) }];
    }

    try {
      const unwrapped: WAMessage = { ...message, message: content };
      const data = (await downloadMediaMessage(unwrapped, "buffer", {}, {
        logger: silentLogger,
        reuploadRequest: socket.updateMediaMessage,
      })) as Buffer;
      log.info({ kind, bytes: data.length, mimeType }, "media downloaded");
      return [
        {
          kind,
          mimeType,
          data,
          isVoiceNote: Boolean(audio?.ptt),
          seconds: audio?.seconds ?? undefined,
        },
      ];
    } catch (error) {
      log.error({ err: error, kind }, "media download failed");
      return [];
    }
  }

  /** Exponential backoff: hammering the connection is how a number gets flagged. */
  private reconnect(onMessage: MessageHandler): void {
    // Repeatedly connecting then being dropped means something else holds the
    // session. Reconnecting harder only makes it worse.
    const recent = this.recentOpens.filter((t) => Date.now() - t < 60_000);
    if (recent.length >= 5) {
      log.error(
        { opensInLastMinute: recent.length },
        "connection keeps being replaced - another instance is probably running. Stopping.",
      );
      this.stopping = true;
      return;
    }
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

  /**
   * Reconnects take a few seconds, and an approval typed during one would
   * otherwise fail with "Connection Closed" and lose the reply. Wait for the
   * socket to come back rather than throwing immediately.
   */
  private async waitForConnection(timeoutMs = 20_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!this.connected && !this.stopping && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return this.connected;
  }

  async send(jid: string, text: string): Promise<void> {
    if (!this.socket) throw new Error("Channel not started");
    if (!this.connected && !(await this.waitForConnection())) {
      throw new Error("WhatsApp is not connected - the message was not sent");
    }
    try {
      const sent = await this.socket!.sendMessage(jid, { text });
      if (sent?.key.id) this.ownSends.add(sent.key.id);
    } catch (error) {
      // A send that raced a reconnect is worth exactly one retry.
      if (!(await this.waitForConnection())) throw error;
      const sent = await this.socket!.sendMessage(jid, { text });
      if (sent?.key.id) this.ownSends.add(sent.key.id);
    }
  }

  async sendImage(jid: string, filePath: string, caption?: string): Promise<void> {
    if (!this.socket) throw new Error("Channel not started");
    if (!this.connected && !(await this.waitForConnection())) {
      throw new Error("WhatsApp is not connected - the photo was not sent");
    }
    const image = readFileSync(filePath);
    const sent = await this.socket.sendMessage(jid, caption ? { image, caption } : { image });
    if (sent?.key.id) this.ownSends.add(sent.key.id);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.socket?.end(undefined);
    this.socket = null;
  }
}
