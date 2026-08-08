/**
 * Minimal signed-cookie session. Holds only the athlete id — tokens live in the
 * database, never in the cookie.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "stravinator_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set.");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function serializeSession(athleteId: string): string {
  return `${athleteId}.${sign(athleteId)}`;
}

export function parseSession(raw: string | undefined): string | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const athleteId = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(athleteId));

  // Constant-time compare, and length-check first since timingSafeEqual throws
  // on a length mismatch.
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? athleteId : null;
}

export async function getAthleteId(): Promise<string | null> {
  const store = await cookies();
  return parseSession(store.get(COOKIE)?.value);
}

/** Throws where an unauthenticated request should never have got through. */
export async function requireAthleteId(): Promise<string> {
  const id = await getAthleteId();
  if (!id) throw new SessionExpiredError();
  return id;
}

export async function setSession(athleteId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, serializeSession(athleteId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has expired. Please sign in with Strava again.");
    this.name = "SessionExpiredError";
  }
}

export const SESSION_COOKIE = COOKIE;
