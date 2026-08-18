import { beforeEach, expect, it, vi } from "vitest";
import { alertingRuleViewFixture } from "../test-fixtures";
import type { AlertingRuleView } from "../types";
import type { AlertingPreviewScope } from "./resource/preview-overlay";
import { listAlertingRules, pauseAlertingRule } from "./server";

const mocks = vi.hoisted(() => ({
  listAllRules: vi.fn<
    (org: string, filter?: { previewId: null }) => Promise<AlertingRuleView[]>
  >(async () => []),
  pauseRule: vi.fn(async () => {}),
  getPreviewScopes: vi.fn<
    (org: string, preview: string) => Promise<AlertingPreviewScope[]>
  >(async () => []),
}));

vi.mock("./repository", () => ({
  listAllRules: mocks.listAllRules,
  pauseRule: mocks.pauseRule,
}));
vi.mock("@/data/previews/repoids", () => ({
  getPreviewScopes: mocks.getPreviewScopes,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAllRules.mockResolvedValue([]);
  mocks.getPreviewScopes.mockResolvedValue([]);
});

// The triage headline count and the label suggestions both read this as
// "the organization's rules": a preview rule slipping in here inflates the
// count and offers a suggestion nobody live can route to.
it("scopes to live rules, excluding previews, by default", async () => {
  await listAlertingRules();

  expect(mocks.listAllRules).toHaveBeenCalledWith("test_org", {
    previewId: null,
  });
});

// The alerts page's instances are already preview-scoped: a rule inventory
// that stayed live-only would leave a firing preview rule with no match,
// rendering as a bare id instead of its name.
it("overlays preview rules onto the org's rules when a preview is named", async () => {
  const live = alertingRuleViewFixture({
    id: "rule-live",
    previewId: null,
    repoid: "repo-live",
  });
  const previewOnly = alertingRuleViewFixture({
    id: "rule-preview",
    previewId: "pr-1",
    repoid: "repo-preview",
  });
  mocks.listAllRules.mockResolvedValue([live, previewOnly]);
  mocks.getPreviewScopes.mockResolvedValue([
    { id: "pr-1", repoid: "repo-preview" },
  ]);

  const result = await listAlertingRules({ data: { preview: "pr-1" } });

  expect(mocks.listAllRules).toHaveBeenCalledWith("test_org");
  expect(mocks.getPreviewScopes).toHaveBeenCalledWith("test_org", "pr-1");
  expect(result.map((r) => r.id).sort()).toEqual(["rule-live", "rule-preview"]);
});

// The column is a uuid, so a malformed id reaches Postgres as invalid input
// syntax and comes back a 500. It is bad request data: reject it at the edge.
it("rejects a rule id that is not a uuid before reading the database", async () => {
  await expect(
    pauseAlertingRule({ data: { ruleId: "not-a-uuid" } }),
  ).rejects.toThrow();

  expect(mocks.pauseRule).not.toHaveBeenCalled();
});
