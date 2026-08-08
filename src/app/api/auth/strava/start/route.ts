import { NextResponse } from "next/server";
import { randomBytes, createHmac } from "node:crypto";
import { buildAuthorizeUrl } from "@/lib/strava";

/**
 * Kicks off the Strava OAuth flow. The invite code is validated here, before we
 * send anyone to Strava — an uninvited athlete should never see the consent
 * screen at all.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const invite = url.searchParams.get("invite")?.trim() ?? "";

  if (!isValidInvite(invite)) {
    return NextResponse.redirect(new URL("/?error=invalid-invite", url.origin));
  }

  // The state carries the invite through the redirect, signed so it can't be
  // swapped for one we never issued.
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${nonce}:${invite}`;
  const state = `${payload}.${signState(payload)}`;

  return NextResponse.redirect(buildAuthorizeUrl(state));
}

function isValidInvite(code: string): boolean {
  const allowed = (process.env.INVITE_CODES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(code);
}

export function signState(payload: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
