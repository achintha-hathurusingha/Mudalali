import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * Single-operator auth: one shared password, a signed cookie, nothing else.
 *
 * Deliberately small, but not fake. This page edits prices and shows every
 * customer's phone number and address, so it must not be a page that anyone
 * who finds the URL can read. When a second person needs access, replace this
 * with real accounts rather than sharing the password further.
 */

const COOKIE = "mudalali_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

function secret(): Uint8Array {
  const raw = process.env.SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(raw);
}

/** Constant-time-ish compare, so the password cannot be guessed a character at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function passwordIsCorrect(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) throw new Error("ADMIN_PASSWORD is not set");
  return sameSecret(candidate, expected);
}

export async function createSession(): Promise<void> {
  const token = await new SignJWT({ role: "operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = COOKIE;
