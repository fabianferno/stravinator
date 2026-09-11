import { NextResponse } from "next/server";
import { randomBytes, createHmac } from "node:crypto";
import { buildAuthorizeUrl } from "@/lib/strava";

/**
 * Kicks off the Strava OAuth flow. Anyone may connect; the only gate is
 * Strava's own consent screen.
 */
export async function GET() {
  // The state is a signed nonce so the callback can reject a redirect we
  // never issued.
  const nonce = randomBytes(16).toString("base64url");
  const state = `${nonce}.${signState(nonce)}`;

  return NextResponse.redirect(buildAuthorizeUrl(state));
}

export function signState(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
