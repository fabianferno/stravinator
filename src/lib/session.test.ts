import { describe, it, expect, beforeAll } from "vitest";
import { serializeSession, parseSession } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-value";
});

describe("session cookie", () => {
  it("round-trips an athlete id", () => {
    expect(parseSession(serializeSession("12345"))).toBe("12345");
  });

  it("rejects a tampered athlete id", () => {
    const raw = serializeSession("12345");
    const forged = raw.replace("12345", "99999");
    expect(parseSession(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const raw = serializeSession("12345");
    expect(parseSession(raw.slice(0, -1) + "x")).toBeNull();
  });

  it("rejects a signature signed with a different secret", () => {
    const raw = serializeSession("12345");
    process.env.SESSION_SECRET = "a-completely-different-secret";
    expect(parseSession(raw)).toBeNull();
    process.env.SESSION_SECRET = "test-secret-value";
  });

  it("rejects malformed and missing values", () => {
    expect(parseSession(undefined)).toBeNull();
    expect(parseSession("")).toBeNull();
    expect(parseSession("nodot")).toBeNull();
    expect(parseSession(".onlysig")).toBeNull();
  });

  it("does not throw on a signature of the wrong length", () => {
    expect(parseSession("12345.short")).toBeNull();
  });
});
