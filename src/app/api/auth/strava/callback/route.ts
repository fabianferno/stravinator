import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { exchangeCode } from "@/lib/strava";
import { upsertAthlete } from "@/lib/db/athletes";
import { setSession } from "@/lib/session";
import { signState } from "../start/route";

export async function GET(req: Request) {
  const url = new URL(req.url);

  // The athlete can decline on Strava's consent screen.
  if (url.searchParams.get("error")) {
    return NextResponse.redirect(new URL("/?error=declined", url.origin));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !verifyState(state)) {
    return NextResponse.redirect(new URL("/?error=bad-state", url.origin));
  }

  try {
    const { tokens, athlete } = await exchangeCode(code);

    await upsertAthlete({
      id: tokens.athleteId,
      name: athlete ? `${athlete.firstname ?? ""} ${athlete.lastname ?? ""}`.trim() : "Athlete",
      avatar: athlete?.profile_medium ?? null,
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });

    await setSession(tokens.athleteId);
    return NextResponse.redirect(new URL("/activities", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/?error=auth-failed", url.origin));
  }
}

function verifyState(state: string | null): boolean {
  if (!state) return false;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return false;

  const expected = Buffer.from(signState(state.slice(0, dot)));
  const given = Buffer.from(state.slice(dot + 1));
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
