import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";

let dbRunbooks: { project: string; slug: string }[] = [];

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => Promise.resolve(dbRunbooks)),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
}));

vi.mock("@/db/schema", () => ({
  runbooks: {
    organizationId: "organization_id",
    repoid: "repoid",
    preview: "preview",
    project: "project",
    slug: "slug",
  },
}));

import { validateAlertRunbookLinks } from "./runbook-links.server";

const orgId = "org-nb-links";
const repoid = "repo-nb-links";

const alertEntry = (path: string, name: string, runbook?: string) => ({
  path,
  resource: {
    kind: "AlertRule",
    metadata: { name, project: "default" },
    spec: {
      evaluationInterval: "1m",
      notificationMessage: { title: "t" },
      query: "SELECT 1",
      ...(runbook ? { runbook } : {}),
    },
  },
});

const runbookEntry = (name: string) => ({
  path: `${name}.yaml`,
  resource: {
    kind: "Runbook",
    metadata: { name, project: "default" },
    spec: { markdown: { inline: "# hi" } },
  },
});

describe("validateAlertRunbookLinks", () => {
  beforeEach(() => {
    dbRunbooks = [];
  });

  it("passes when the runbook is in the same apply batch", async () => {
    await expect(
      validateAlertRunbookLinks({
        orgId,
        repoid,
        preview: "",
        alerts: [alertEntry("a.yaml", "a", "runbook")],
        runbooks: [runbookEntry("runbook")],
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when the runbook already exists in the DB", async () => {
    dbRunbooks = [{ project: "default", slug: "runbook" }];
    await expect(
      validateAlertRunbookLinks({
        orgId,
        repoid,
        preview: "",
        alerts: [alertEntry("a.yaml", "a", "runbook")],
        runbooks: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when the linked runbook does not exist", async () => {
    await expect(
      validateAlertRunbookLinks({
        orgId,
        repoid,
        preview: "",
        alerts: [alertEntry("a.yaml", "a", "missing")],
        runbooks: [],
      }),
    ).rejects.toBeInstanceOf(ApplyValidationError);
  });

  it("ignores alerts with no runbook", async () => {
    await expect(
      validateAlertRunbookLinks({
        orgId,
        repoid,
        preview: "",
        alerts: [alertEntry("a.yaml", "a")],
        runbooks: [],
      }),
    ).resolves.toBeUndefined();
  });
});
