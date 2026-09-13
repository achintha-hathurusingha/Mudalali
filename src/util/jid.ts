/**
 * WhatsApp identifiers are not stable strings. The same person can arrive as
 * `9477...@s.whatsapp.net`, `9477...:12@s.whatsapp.net` (a linked device) or
 * `...@lid` (Baileys 7's privacy identifier). Comparing with === misroutes them.
 */

/** The identity portion of a JID: no device suffix, no server. */
export function userOf(jid: string): string {
  const [before = ""] = jid.split("@");
  return before.split(":")[0] ?? "";
}

/** The digits, for display. Meaningless for @lid JIDs, which are not phone numbers. */
export function phoneOf(jid: string): string {
  return userOf(jid);
}

export function sameUser(a: string, b: string): boolean {
  return userOf(a) === userOf(b) && userOf(a) !== "";
}

/**
 * True when `jid` is any of the configured operator identities.
 * A LID is a different number from the phone number, so an operator whose
 * messages arrive as @lid must add that JID to OPERATOR_WA_JID as well.
 */
export function isOperator(jid: string, operatorJids: readonly string[]): boolean {
  return operatorJids.some((candidate) => sameUser(jid, candidate));
}
