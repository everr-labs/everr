// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveGithubConfiguration } from "./configuration";

const configured = {
  GITHUB_APP_INSTALL_URL: "https://github.com/apps/example/installations/new",
  GITHUB_APP_STATE_SECRET: "s".repeat(32),
  GITHUB_APP_WEBHOOK_SECRET: "w".repeat(32),
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: "private-key",
  INGRESS_COLLECTOR_URL: "http://collector:8080/webhook/github",
};

describe("GitHub integration configuration", () => {
  it("preserves existing configured installations", () => {
    expect(resolveGithubConfiguration(configured)).toEqual({
      ...configured,
      GITHUB_APP_ID: 123,
    });
  });
  it("can disable a configured installation", () => {
    expect(
      resolveGithubConfiguration({
        ...configured,
        EVERR_GITHUB_ENABLED: "false",
      }),
    ).toBeUndefined();
  });
  it("rejects partial configuration without exposing secret values", () => {
    expect(() =>
      resolveGithubConfiguration({ GITHUB_APP_PRIVATE_KEY: "secret-value" }),
    ).toThrow("Invalid GitHub integration configuration");
    try {
      resolveGithubConfiguration({ GITHUB_APP_PRIVATE_KEY: "secret-value" });
    } catch (error) {
      expect(String(error)).not.toContain("secret-value");
    }
  });
  it("requires configuration when explicitly enabled", () => {
    expect(() =>
      resolveGithubConfiguration({ EVERR_GITHUB_ENABLED: "true" }),
    ).toThrow("GITHUB_APP_ID");
  });
});
