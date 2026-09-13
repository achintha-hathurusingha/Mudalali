import { config } from "./config.js";
import { acquireLock } from "./util/lock.js";
import { log } from "./log.js";
import { closeDb } from "./memory/db.js";
import { BaileysChannel } from "./channel/baileys.js";
import { ConsoleChannel } from "./channel/console.js";
import { ConsoleOperatorChannel } from "./channel/console-operator.js";
import { createUnderstander } from "./understanding/index.js";
import { createPipeline } from "./action/handler.js";
import type { Channel } from "./channel/types.js";

async function main(): Promise<void> {
  // One process per WhatsApp session, or they displace each other endlessly.
  const releaseLock = config.channel === "baileys" ? acquireLock(`${config.waAuthDir}/agent.lock`) : () => {};

  const base: Channel = config.channel === "console" ? new ConsoleChannel() : new BaileysChannel();
  const channel: Channel = config.operatorConsole ? new ConsoleOperatorChannel(base) : base;
  const understander = createUnderstander();

  log.info(
    { channel: channel.name, provider: understander.name, mode: config.mode },
    "starting",
  );
  if (config.mode === "suggest") {
    log.info("suggest-only mode: nothing goes to a customer without your approval");
  }

  const pipeline = createPipeline(channel, understander);
  await channel.start(pipeline.handle);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    await pipeline.flush();
    await channel.stop();
    await closeDb();
    releaseLock();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  log.error({ err: error }, "fatal");
  process.exit(1);
});
