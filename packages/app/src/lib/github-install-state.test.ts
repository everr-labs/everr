// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createInstallState, parseInstallState } from "./github-install-state";

vi.mock("#app/integrations/github/configuration.ts", () => ({
  requireGithubConfiguration: () => ({
    GITHUB_APP_STATE_SECRET: "test-github-install-state-secret",
  }),
}));

const input = { organizationId: "org-1", userId: "user-1", now: 1_000 };

it("accepts the signed state generated for a GitHub installation", () => {
  expect(parseInstallState(createInstallState(input), 1_001)).toEqual({
    organizationId: input.organizationId,
    userId: input.userId,
    exp: 1_600,
  });
});

it("rejects a state whose organization was changed after signing", () => {
  const state = createInstallState(input);
  const [encodedPayload, signature] = state.split(".");
  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString(),
  );
  payload.organizationId = "another-org";
  const alteredPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );

  expect(() =>
    parseInstallState(`${alteredPayload}.${signature}`, 1_001),
  ).toThrow("Invalid state signature.");
});

it("rejects expired installation state", () => {
  expect(() => parseInstallState(createInstallState(input), 1_601)).toThrow(
    "State has expired.",
  );
});
