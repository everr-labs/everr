import { describe, expect, it } from "vitest";
import { describeApiKeyScopes, hasApiKeyScope } from "@/lib/api-key-scopes";

describe("hasApiKeyScope", () => {
  it("treats null permissions as fully scoped (legacy keys)", () => {
    expect(hasApiKeyScope(null, "ingest", "write")).toBe(true);
    expect(hasApiKeyScope(undefined, "apply")).toBe(true);
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
    expect(hasApiKeyScope({ ingest: ["write"] }, "ingest", "delete")).toBe(
      false,
    );
  });

  it("defaults the action to the wildcard when none is given", () => {
    expect(hasApiKeyScope({ apply: ["*"] }, "apply")).toBe(true);
    expect(hasApiKeyScope({ apply: ["read"] }, "apply")).toBe(false);
  });
});

describe("describeApiKeyScopes", () => {
  it("lists every known scope for legacy keys with no permissions", () => {
    expect(describeApiKeyScopes(null).sort()).toEqual(["apply", "ingest"]);
  });

  it("lists only the scopes the key actually has", () => {
    expect(describeApiKeyScopes({ apply: ["*"] })).toEqual(["apply"]);
    expect(describeApiKeyScopes({ ingest: ["write"] })).toEqual(["ingest"]);
  });

  it("drops scopes with an empty action array", () => {
    expect(describeApiKeyScopes({ ingest: [], apply: ["*"] })).toEqual([
      "apply",
    ]);
  });

  it("returns an empty list when no scope has any action", () => {
    expect(describeApiKeyScopes({ ingest: [], apply: [] })).toEqual([]);
  });
});
