import { beforeEach, expect, it, vi } from "vitest";
import type { AlertingPreviewScope } from "../rules/resource/preview-overlay";
import { alertingRuleViewFixture } from "../test-fixtures";
import type { AlertingAlert, AlertingRuleView } from "../types";
import { listAlertingAlerts } from "./server";

const mocks = vi.hoisted(() => ({
  listAlerts: vi.fn<(org: string) => Promise<AlertingAlert[]>>(async () => []),
  listAllRules: vi.fn<(org: string) => Promise<AlertingRuleView[]>>(
    async () => [],
  ),
  getPreviewScopes: vi.fn<
    (org: string, preview: string) => Promise<AlertingPreviewScope[]>
  >(async () => []),
}));

vi.mock("./repository", () => ({ listAlerts: mocks.listAlerts }));
vi.mock("../rules/repository", () => ({ listAllRules: mocks.listAllRules }));
vi.mock("@/data/previews/repoids", () => ({
  getPreviewScopes: mocks.getPreviewScopes,
}));

const firing = (ruleId: string): AlertingAlert => ({
  key: `${ruleId}:fp`,
  fingerprint: "fp",
  rule: ruleId,
  tenant: "test_org",
  status: "firing",
  labels: {},
  value: 1,
  active_since: "2026-08-17T10:00:00Z",
  last_seen: "2026-08-17T10:05:00Z",
  absent_count: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAlerts.mockResolvedValue([]);
  mocks.listAllRules.mockResolvedValue([]);
  mocks.getPreviewScopes.mockResolvedValue([]);
});

// The rule still exists on live and keeps firing there, but this branch
// deleted it: those instances are live's, not the branch's.
it("drops the instances of a rule the named preview deleted", async () => {
  mocks.listAllRules.mockResolvedValue([
    alertingRuleViewFixture({
      id: "live-deleted",
      name: "default/deleted",
      repoid: "repo-1",
      previewId: null,
    }),
    alertingRuleViewFixture({
      id: "pr-kept",
      name: "default/kept",
      repoid: "repo-1",
      previewId: "pr-1",
    }),
  ]);
  mocks.getPreviewScopes.mockResolvedValue([{ id: "pr-1", repoid: "repo-1" }]);
  mocks.listAlerts.mockResolvedValue([
    firing("live-deleted"),
    firing("pr-kept"),
  ]);

  const result = await listAlertingAlerts({ data: { preview: "pr-1" } });

  expect(result.map((alert) => alert.rule)).toEqual(["pr-kept"]);
});
