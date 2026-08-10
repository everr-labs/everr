import { beforeEach, expect, it, vi } from "vitest";
import { listAlertingRules } from "./server";

const mocks = vi.hoisted(() => ({ listAllRules: vi.fn(async () => []) }));

vi.mock("./repository", () => ({ listAllRules: mocks.listAllRules }));
// server.ts also imports getPreviewScopes for the sibling handlers; stub it
// so this file doesn't pull in the real db client's env access.
vi.mock("@/data/previews/repoids", () => ({ getPreviewScopes: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAllRules.mockResolvedValue([]);
});

// The triage headline count and the routing suggestions both read this as
// "the organization's rules": a preview rule slipping in here inflates the
// count and offers a suggestion nobody live can route to.
it("scopes to live rules, excluding previews", async () => {
  await listAlertingRules();

  expect(mocks.listAllRules).toHaveBeenCalledWith("test_org", {
    previewId: null,
  });
});
