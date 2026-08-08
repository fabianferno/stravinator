import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getAthlete, getAthleteTokens, saveAthleteTokens, upsertAthlete } from "./athletes";
import { appliedMigrations, migrate } from "./migrate";
import { getPool, query } from "./pool";
import { postgresAvailable, setupTestDb, teardownTestDb, truncateAll } from "./testdb";

const available = await postgresAvailable();

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

  describe("pool", () => {
    it("returns the same pool instance across calls (hot-reload safe)", () => {
      expect(getPool()).toBe(getPool());
    });
  });

  describe("migrate", () => {
    it("records every migration file it applied", async () => {
      const names = (await appliedMigrations()).map((m) => m.name);
      expect(names).toContain("001_init.sql");
    });

    it("is idempotent: a second run applies nothing", async () => {
      expect(await migrate()).toEqual([]);
    });

    it("created the tables and the claim index", async () => {
      const { rows } = await query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = current_schema()",
      );
      const tables = rows.map((r) => r.tablename);
      expect(tables).toEqual(
        expect.arrayContaining(["athletes", "jobs", "invites", "schema_migrations"]),
      );

      const { rows: idx } = await query<{ indexname: string }>(
        "SELECT indexname FROM pg_indexes WHERE tablename = 'jobs' AND schemaname = current_schema()",
      );
      expect(idx.map((r) => r.indexname)).toContain("jobs_status_created_at_idx");
    });

    it("rejects a status outside the JobStatus union", async () => {
      await upsertAthlete({
        id: "a1",
        name: "A",
        avatar: null,
        tokens: { accessToken: "x", refreshToken: "y", expiresAt: 1_800_000_000 },
      });
      await expect(
        query("INSERT INTO jobs (athlete_id, activity_id, status) VALUES ($1, '1', 'bogus')", [
          "a1",
        ]),
      ).rejects.toThrow();
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
      const { rows } = await query<{ n: string }>("SELECT count(*) AS n FROM athletes");
      expect(Number(rows[0].n)).toBe(1);
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

  describe("invites", () => {
    it("stores a code and marks it used by an athlete", async () => {
      await upsertAthlete({
        id: "a1",
        name: "Ada",
        avatar: null,
        tokens: { accessToken: "x", refreshToken: "y", expiresAt: 1_800_000_000 },
      });
      await query("INSERT INTO invites (code) VALUES ('LETMEIN')");
      await query("UPDATE invites SET used_by = 'a1', used_at = now() WHERE code = 'LETMEIN'");
      const { rows } = await query<{ used_by: string; used_at: Date }>(
        "SELECT used_by, used_at FROM invites WHERE code = 'LETMEIN'",
      );
      expect(rows[0].used_by).toBe("a1");
      expect(rows[0].used_at).toBeInstanceOf(Date);
    });

    it("rejects a duplicate code", async () => {
      await query("INSERT INTO invites (code) VALUES ('DUPE')");
      await expect(query("INSERT INTO invites (code) VALUES ('DUPE')")).rejects.toThrow();
    });
  });
});
