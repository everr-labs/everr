import { describe, expect, it } from "vite-plus/test";
import { describeRedirectUri, isLoopbackRedirectUri } from "./mcp-redirect-uri";

describe("isLoopbackRedirectUri", () => {
  it.each([
    "http://localhost:3118/callback",
    "http://127.0.0.1:53682/callback",
    "http://[::1]:8080/oauth/callback",
    "http://localhost/callback",
  ])("accepts %s", (uri) => {
    expect(isLoopbackRedirectUri(uri)).toBe(true);
  });

  it.each([
    "https://localhost:3118/callback",
    "http://localhost.evil.example/callback",
    "http://127.0.0.2/callback",
    "https://claude.ai/api/mcp/auth_callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
    "not a url",
  ])("rejects %s", (uri) => {
    expect(isLoopbackRedirectUri(uri)).toBe(false);
  });
});

describe("describeRedirectUri", () => {
  it("describes loopback callbacks as this computer, with the port", () => {
    expect(describeRedirectUri("http://localhost:3118/callback")).toEqual({
      kind: "this-computer",
      address: "localhost:3118",
    });
    expect(describeRedirectUri("http://127.0.0.1:53682/callback")).toEqual({
      kind: "this-computer",
      address: "127.0.0.1:53682",
    });
    expect(describeRedirectUri("http://[::1]:8080/cb")).toEqual({
      kind: "this-computer",
      address: "[::1]:8080",
    });
  });

  it("describes https callbacks by host, ignoring userinfo", () => {
    expect(describeRedirectUri("https://claude.ai/api/mcp/auth_callback")).toEqual({
      kind: "app",
      address: "claude.ai",
    });
    expect(describeRedirectUri("https://claude.ai@attacker.example/cb")).toEqual({
      kind: "app",
      address: "attacker.example",
    });
  });

  it("keeps the scheme for custom schemes and plain http", () => {
    expect(describeRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toEqual({
      kind: "app",
      address: "cursor://anysphere.cursor-mcp",
    });
    expect(describeRedirectUri("http://attacker.example/cb")).toEqual({
      kind: "app",
      address: "http://attacker.example",
    });
  });

  it("returns null for unparsable input", () => {
    expect(describeRedirectUri("not a url")).toBeNull();
    expect(describeRedirectUri("")).toBeNull();
  });
});
