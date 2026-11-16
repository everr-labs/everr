import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_MCP_REDIRECT_ALLOWLIST,
  isAllowedRedirectUri,
  parseRedirectAllowlist,
} from "./mcp-redirects";

const cloud = parseRedirectAllowlist(DEFAULT_MCP_REDIRECT_ALLOWLIST);

describe("isAllowedRedirectUri with the default list", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    "https://chatgpt.com/connector/oauth/conn_abc123",
    "https://vscode.dev/redirect",
    "https://insiders.vscode.dev/redirect",
    "https://www.cursor.com/agents/mcp/oauth/callback",
    "cursor://anysphere.cursor-mcp/oauth/callback",
  ])("allows %s", (uri) => {
    expect(isAllowedRedirectUri(uri, cloud)).toBe(true);
  });

  it.each([
    ["an unlisted host", "https://attacker.example/cb"],
    ["a host suffix", "https://chatgpt.com.evil.example/connector/oauth/x"],
    ["userinfo before the host", "https://chatgpt.com@evil.example/connector/oauth/x"],
    ["a .. escape from the prefix", "https://chatgpt.com/connector/oauth/../../evil"],
    ["an encoded .. escape", "https://chatgpt.com/connector/oauth/%2e%2e/%2e%2e/evil"],
    ["the prefix without its trailing slash", "https://chatgpt.com/connector/oauth"],
    ["a longer exact path", "https://claude.ai/api/mcp/auth_callback/extra"],
    ["a different scheme", "http://claude.ai/api/mcp/auth_callback"],
    ["a different custom scheme host", "cursor://evil/oauth/callback"],
    ["garbage", "not a url"],
  ])("rejects %s", (_name, uri) => {
    expect(isAllowedRedirectUri(uri, cloud)).toBe(false);
  });
});

describe("loopback", () => {
  it.each([
    "http://localhost:3118/callback",
    "http://127.0.0.1:53682/callback",
    "http://[::1]:8080/callback",
  ])("allows %s even with an empty list", (uri) => {
    expect(isAllowedRedirectUri(uri, parseRedirectAllowlist(""))).toBe(true);
  });

  it("rejects https on an empty list", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback", [])).toBe(false);
  });
});

describe("parseRedirectAllowlist", () => {
  it("trims entries and ignores empty ones", () => {
    const list = parseRedirectAllowlist(" https://a.example/cb , ,https://b.example/x/* ,");
    expect(isAllowedRedirectUri("https://a.example/cb", list)).toBe(true);
    expect(isAllowedRedirectUri("https://b.example/x/anything", list)).toBe(true);
    expect(isAllowedRedirectUri("https://b.example/y", list)).toBe(false);
  });

  it.each([
    ["a wildcard host", "https://*.example.com/cb"],
    ["a wildcard mid-path", "https://a.example/*/cb"],
    ["a bare trailing wildcard", "https://a.example/cb*"],
    ["an unparsable entry", "not a url"],
  ])("throws on %s, naming the variable and entry", (_name, entry) => {
    expect(() => parseRedirectAllowlist(`https://ok.example/cb,${entry}`)).toThrow(
      `MCP_OAUTH_ALLOWED_REDIRECT_URIS entry "${entry}"`,
    );
  });
});
