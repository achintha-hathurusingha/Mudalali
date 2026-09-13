import { openSync, closeSync, writeSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Only one process may hold a WhatsApp session. Two Baileys instances sharing
 * an auth directory fight over the connection - each one displaces the other,
 * producing an endless 440 loop and, eventually, a revoked session.
 */
export function acquireLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true });

  if (existsSync(path)) {
    const holder = Number(readFileSync(path, "utf8").trim());
    if (Number.isFinite(holder) && holder > 0 && isAlive(holder)) {
      throw new Error(
        `Another agent is already running as process ${holder}. ` +
          `Stop it first - two instances will fight over the WhatsApp session.`,
      );
    }
    // The holder is gone; the lock is stale.
    try {
      unlinkSync(path);
    } catch {
      /* raced with another cleanup */
    }
  }

  let fd: number;
  try {
    fd = openSync(path, "wx"); // fails if it appeared in the meantime
  } catch {
    throw new Error(`Another agent grabbed the lock at ${path}. Only one may run.`);
  }
  writeSync(fd, String(process.pid));
  closeSync(fd);

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      unlinkSync(path);
    } catch {
      /* already gone */
    }
  };

  process.on("exit", release);
  return release;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
