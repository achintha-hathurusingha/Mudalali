import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function list(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

export type Provider = "gemini" | "claude";
export type PolicyMode = "suggest" | "auto";

const operatorJids = list("OPERATOR_WA_JID", "");
if (operatorJids.length === 0) throw new Error("Missing required env var: OPERATOR_WA_JID");

export const config = {
  /** Which understanding adapter to use. Swap without touching the pipeline. */
  provider: (process.env.LLM_PROVIDER ?? "gemini") as Provider,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
  claudeModel: process.env.CLAUDE_MODEL ?? "claude-opus-5",

  databaseUrl: required("DATABASE_URL"),
  /** Path to the provider's CA certificate. Without it TLS is unverified. */
  databaseCaCertPath: process.env.DATABASE_CA_CERT || null,

  /**
   * Your own number(s) in WhatsApp JID form: 9477XXXXXXX@s.whatsapp.net
   * Comma-separated. If your messages arrive as an @lid JID under Baileys 7,
   * add that one too - a LID is not derived from the phone number.
   */
  operatorJids,
  /** Where drafts and alerts are sent. */
  operatorJid: operatorJids[0]!,

  channel: (process.env.CHANNEL ?? "baileys") as "baileys" | "console",
  waAuthDir: process.env.WA_AUTH_DIR ?? "./.wa-auth",

  /**
   * suggest = every reply waits for your approval (start here)
   * auto    = safe intents send themselves, everything else still waits
   */
  mode: (process.env.POLICY_MODE ?? "suggest") as PolicyMode,
  autoIntents: list("AUTO_INTENTS", "greeting,availability,delivery,payment"),
  minConfidence: Number(process.env.MIN_CONFIDENCE ?? 0.8),

  /** How many prior messages of the conversation the model sees. */
  historyTurns: Number(process.env.HISTORY_TURNS ?? 10),

  /**
   * People type one thought as three messages. Wait this long for the rest
   * before running the model, so one intent costs one call and one draft.
   */
  debounceMs: Number(process.env.DEBOUNCE_MS ?? 5000),

  /**
   * Send the model's holding line to the customer the moment something is
   * escalated, instead of leaving them in silence until you reply.
   */
  autoAckEscalations: bool("AUTO_ACK_ESCALATIONS", true),

  /**
   * Largest photo or voice note we will send to the model. Gemini's inline
   * limit is 20 MB for the whole request; WhatsApp caps media at 16 MB.
   */
  maxMediaBytes: Number(process.env.MAX_MEDIA_BYTES ?? 8 * 1024 * 1024),

  /**
   * A misread photo is a worse failure than a misread sentence, so media never
   * auto-replies until you have watched it work. Applies even in auto mode.
   */
  autoReplyMedia: bool("AUTO_REPLY_MEDIA", false),
} as const;
