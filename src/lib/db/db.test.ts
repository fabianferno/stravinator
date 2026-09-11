import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getAthlete, getAthleteTokens, saveAthleteTokens, upsertAthlete } from "./athletes";
import { athletes, ensureIndexes, getClient, jobs } from "./client";
import { mongoAvailable, setupTestDb, teardownTestDb, truncateAll } from "./testdb";

const available = await mongoAvailable();

describe.skipIf(!available)("db", () => {
  beforeAll(async () => {
    await setupTestDb("test_db_suite");
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await truncateAll();
  });

  describe("client", () => {
    it("returns the same client instance across calls (hot-reload safe)", () => {
      expect(getClient()).toBe(getClient());
    });
  });

  describe("ensureIndexes", () => {
    it("is idempotent: a second run does not throw", async () => {
      await expect(ensureIndexes()).resolves.toBeUndefined();
    });

    it("created the claim index", async () => {
      const idx = await jobs().indexes();
      expect(idx.map((i) => i.name)).toEqual(
        expect.arrayContaining(["jobs_status_created_at_idx", "jobs_athlete_created_at_idx"]),
      );
    });
  });

  describe("athletes", () => {
    const tokens = { accessToken: "acc1", refreshToken: "ref1", expiresAt: 1_800_000_000 };

    it("upserts and reads back", async () => {
      await upsertAthlete({ id: "a1", name: "Ada", avatar: "https://img/a.png", tokens });
      const a = await getAthlete("a1");
      // Reads carry the athlete id so the record can go straight to the Strava
      // client, which needs it to refresh.
      expect(a).toEqual({
        id: "a1",
        name: "Ada",
        avatar: "https://img/a.png",
        tokens: { ...tokens, athleteId: "a1" },
      });
    });

    it("upsert on conflict updates profile and tokens", async () => {
      await upsertAthlete({ id: "a1", name: "Ada", avatar: null, tokens });
      await upsertAthlete({
        id: "a1",
        name: "Ada L",
        avatar: "https://img/b.png",
        tokens: { accessToken: "acc2", refreshToken: "ref2", expiresAt: 1_900_000_000 },
      });
      const a = await getAthlete("a1");
      expect(a?.name).toBe("Ada L");
      expect(a?.tokens.refreshToken).toBe("ref2");
      expect(await athletes().countDocuments()).toBe(1);
    });

    // Strava rotates the refresh token; losing the new one strands the athlete.
    it("saveAthleteTokens persists the ROTATED refresh token", async () => {
      await upsertAthlete({ id: "a1", name: "Ada", avatar: null, tokens });
      await saveAthleteTokens("a1", {
        accessToken: "acc-new",
        refreshToken: "ref-ROTATED",
        expiresAt: 1_900_000_000,
      });
      expect(await getAthleteTokens("a1")).toEqual({
        accessToken: "acc-new",
        refreshToken: "ref-ROTATED",
        expiresAt: 1_900_000_000,
        athleteId: "a1",
      });
    });

    it("getAthleteTokens throws a clear error for an unknown athlete", async () => {
      await expect(getAthleteTokens("nope")).rejects.toThrow(/no athlete nope/);
    });

    it("saveAthleteTokens throws for an unknown athlete", async () => {
      await expect(saveAthleteTokens("nope", tokens)).rejects.toThrow(/no athlete nope/);
    });

    it("getAthlete returns null for an unknown athlete", async () => {
      expect(await getAthlete("nope")).toBeNull();
    });
  });
});
