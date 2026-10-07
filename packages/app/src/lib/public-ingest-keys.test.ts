import { describe, expect, it } from "vitest";
import {
  normalizeOrigin,
  originPolicyAllows,
  publicKeyInputError,
  publicKeyMetadataOf,
} from "./public-ingest-keys";

describe("normalizeOrigin", () => {
  it("accepts a bare https origin", () => {
    expect(normalizeOrigin("https://app.example.com")).toBe(
      "https://app.example.com",
    );
  });

  it("lowercases scheme and host", () => {
    expect(normalizeOrigin("HTTPS://App.Example.COM")).toBe(
      "https://app.example.com",
    );
  });

  it("strips default ports like browsers do", () => {
    expect(normalizeOrigin("https://app.example.com:443")).toBe(
      "https://app.example.com",
    );
    expect(normalizeOrigin("http://app.example.com:80")).toBe(
      "http://app.example.com",
    );
  });

  it("keeps non-default ports", () => {
    expect(normalizeOrigin("http://127.0.0.1:8000")).toBe(
      "http://127.0.0.1:8000",
    );
  });

  it("tolerates a lone trailing slash", () => {
    expect(normalizeOrigin("https://app.example.com/")).toBe(
      "https://app.example.com",
    );
  });

  it("rejects paths, queries, and fragments", () => {
    expect(normalizeOrigin("https://app.example.com/path")).toBeNull();
    expect(normalizeOrigin("https://app.example.com/?q=1")).toBeNull();
    expect(normalizeOrigin("https://app.example.com/#x")).toBeNull();
  });

  it("rejects credentials, non-http schemes, and garbage", () => {
    expect(normalizeOrigin("https://user:pw@app.example.com")).toBeNull();
    expect(normalizeOrigin("ftp://app.example.com")).toBeNull();
    expect(normalizeOrigin("file:///etc/passwd")).toBeNull();
    expect(normalizeOrigin("not an origin")).toBeNull();
    expect(normalizeOrigin("null")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
  });
});

describe("publicKeyMetadataOf", () => {
  it("parses a public key metadata object", () => {
    expect(
      publicKeyMetadataOf({
        allowedOrigins: ["https://a.example"],
      }),
    ).toEqual({ allowedOrigins: ["https://a.example"] });
  });

  it("parses metadata handed back as a JSON string", () => {
    expect(
      publicKeyMetadataOf(
        JSON.stringify({ allowedOrigins: ["https://a.example"] }),
      ),
    ).toEqual({ allowedOrigins: ["https://a.example"] });
  });

  it("returns null for missing or malformed origin metadata", () => {
    expect(publicKeyMetadataOf(null)).toBeNull();
    expect(publicKeyMetadataOf(undefined)).toBeNull();
    expect(publicKeyMetadataOf({})).toBeNull();
    expect(publicKeyMetadataOf({ public: false })).toBeNull();
    expect(publicKeyMetadataOf({ public: "true" })).toBeNull();
    expect(publicKeyMetadataOf("not json {")).toBeNull();
    expect(publicKeyMetadataOf([])).toBeNull();
  });

  it("drops non-string entries from allowedOrigins", () => {
    expect(
      publicKeyMetadataOf({
        allowedOrigins: ["https://a.example", 42, null],
      }),
    ).toEqual({ allowedOrigins: ["https://a.example"] });
  });
});

describe("originPolicyAllows (the policy matrix)", () => {
  it("fails closed for unknown configurations and missing public metadata", () => {
    expect(originPolicyAllows("ingest", null, null)).toBe(false);
    expect(originPolicyAllows("public", null, "https://app.example.com")).toBe(
      false,
    );
    expect(originPolicyAllows("public", null, null)).toBe(false);
  });

  it("metadata cannot turn a secret key into a public key", () => {
    expect(
      originPolicyAllows(
        "secret",
        { public: true, allowedOrigins: ["https://app.example.com"] },
        "https://app.example.com",
      ),
    ).toBe(false);
  });
  const publicMeta = {
    allowedOrigins: ["https://app.example.com", "http://127.0.0.1:8000"],
  };

  it("secret key without origin: allowed (server-to-server)", () => {
    expect(originPolicyAllows("secret", null, null)).toBe(true);
  });

  it("public key without origin: rejected (browser-only)", () => {
    expect(originPolicyAllows("public", publicMeta, null)).toBe(false);
  });

  it("secret key with origin: rejected (never from browsers)", () => {
    expect(originPolicyAllows("secret", null, "https://app.example.com")).toBe(
      false,
    );
  });

  it("public key with matching origin: allowed", () => {
    expect(
      originPolicyAllows("public", publicMeta, "https://app.example.com"),
    ).toBe(true);
  });

  it("public key with mismatched origin: rejected", () => {
    expect(
      originPolicyAllows("public", publicMeta, "https://evil.example"),
    ).toBe(false);
  });

  it("normalizes the incoming origin before matching", () => {
    expect(
      originPolicyAllows("public", publicMeta, "HTTPS://APP.EXAMPLE.COM:443"),
    ).toBe(true);
  });

  it('the literal "null" origin never matches', () => {
    expect(originPolicyAllows("public", publicMeta, "null")).toBe(false);
  });
});

describe("publicKeyInputError (creation invariants)", () => {
  it("accepts a valid public key input", () => {
    expect(
      publicKeyInputError({
        public: true,
        allowedOrigins: ["https://app.example.com"],
        scopes: ["ingest"],
      }),
    ).toBeNull();
  });

  it("accepts a plain secret key input", () => {
    expect(publicKeyInputError({ scopes: ["ingest", "apply"] })).toBeNull();
  });

  it("public requires at least one origin", () => {
    expect(
      publicKeyInputError({
        public: true,
        allowedOrigins: [],
        scopes: ["ingest"],
      }),
    ).toMatch(/at least one/);
    expect(publicKeyInputError({ public: true, scopes: ["ingest"] })).toMatch(
      /at least one/,
    );
  });

  it("public requires exactly the ingest capability", () => {
    expect(
      publicKeyInputError({
        public: true,
        allowedOrigins: ["https://a.example"],
        scopes: ["ingest", "apply"],
      }),
    ).toMatch(/only send telemetry/);
    expect(
      publicKeyInputError({
        public: true,
        allowedOrigins: ["https://a.example"],
        scopes: ["apply"],
      }),
    ).toMatch(/only send telemetry/);
  });

  it("origins require a public key", () => {
    expect(
      publicKeyInputError({
        allowedOrigins: ["https://a.example"],
        scopes: ["ingest"],
      }),
    ).toMatch(/require a public key/);
  });

  it("rejects invalid origins", () => {
    expect(
      publicKeyInputError({
        public: true,
        allowedOrigins: ["https://a.example/path"],
        scopes: ["ingest"],
      }),
    ).toMatch(/Not a valid origin/);
  });
});
