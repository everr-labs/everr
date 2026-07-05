import { describe, expect, it } from "vite-plus/test";
import { describeApiKeyScopes, hasApiKeyScope } from "@/lib/api-key-scopes";

describe("hasApiKeyScope", () => {
  it("rejects keys with no capabilities (null/undefined permissions)", () => {
    expect(hasApiKeyScope(null, "ingest", "write")).toBe(false);
    expect(hasApiKeyScope(undefined, "apply")).toBe(false);
  });

  it("returns false when the scope key is absent", () => {
    expect(hasApiKeyScope({ ingest: ["write"] }, "apply")).toBe(false);
  });

  it("returns false when the scope has an empty action array", () => {
    expect(hasApiKeyScope({ ingest: [] }, "ingest", "write")).toBe(false);
  });

  it("honors the wildcard action", () => {
    expect(hasApiKeyScope({ apply: ["*"] }, "apply", "read")).toBe(true);
    expect(hasApiKeyScope({ apply: ["*"] }, "apply", "delete")).toBe(true);
  });

  it("honors the explicit action when no wildcard is set", () => {
    expect(hasApiKeyScope({ ingest: ["write"] }, "ingest", "write")).toBe(true);
    expect(hasApiKeyScope({ ingest: ["write"] }, "ingest", "delete")).toBe(false);
  });

  it("treats a missing action as 'holds the scope at all'", () => {
    // A real apply key carries its concrete action set, not a wildcard — the
    // no-action check must accept it (this is what apply-auth relies on).
    expect(hasApiKeyScope({ apply: ["read", "write", "delete"] }, "apply")).toBe(true);
    expect(hasApiKeyScope({ apply: ["*"] }, "apply")).toBe(true);
    expect(hasApiKeyScope({ apply: ["read"] }, "apply")).toBe(true);
    expect(hasApiKeyScope({ apply: [] }, "apply")).toBe(false);
  });
});

describe("describeApiKeyScopes", () => {
  it("returns an empty list for a key with no permissions", () => {
    expect(describeApiKeyScopes(null)).toEqual([]);
    expect(describeApiKeyScopes(undefined)).toEqual([]);
  });

  it("lists only the scopes the key actually has", () => {
    expect(describeApiKeyScopes({ apply: ["*"] })).toEqual(["apply"]);
    expect(describeApiKeyScopes({ ingest: ["write"] })).toEqual(["ingest"]);
  });

  it("drops scopes with an empty action array", () => {
    expect(describeApiKeyScopes({ ingest: [], apply: ["*"] })).toEqual(["apply"]);
  });

  it("returns an empty list when no scope has any action", () => {
    expect(describeApiKeyScopes({ ingest: [], apply: [] })).toEqual([]);
  });
});
