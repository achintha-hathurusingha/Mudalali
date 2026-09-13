/**
 * Pins the configuration the tests assume.
 *
 * Must be the FIRST import in every test file: `dotenv` does not overwrite
 * variables that are already set, so setting them here wins over whatever is
 * in the developer's .env. Without this, flipping POLICY_MODE locally silently
 * changes what the suite is testing.
 */
process.env.POLICY_MODE = "suggest";
process.env.AUTO_INTENTS = "greeting,availability,delivery,payment";
process.env.MIN_CONFIDENCE = "0.8";
process.env.AUTO_REPLY_MEDIA = "false";
process.env.AUTO_ACK_ESCALATIONS = "true";
process.env.OPERATOR_WA_JID = "94771234567@s.whatsapp.net";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.LOG_LEVEL = "silent";
