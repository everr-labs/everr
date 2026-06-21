import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";

let dbNotebooks: { project: string; slug: string }[] = [];

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => Promise.resolve(dbNotebooks)),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
}));

vi.mock("@/db/schema", () => ({
  notebooks: {
    organizationId: "organization_id",
    repoid: "repoid",
    project: "project",
    slug: "slug",
  },
}));

import { validateAlertNotebookLinks } from "./notebook-links.server";

const orgId = "org-nb-links";
const repoid = "repo-nb-links";

const alertEntry = (path: string, name: string, notebook?: string) => ({
  path,
  resource: {
    kind: "AlertRule",
    metadata: { name, project: "default" },
    spec: {
      evaluationInterval: "1m",
      notificationMessage: { title: "t" },
      query: "SELECT 1",
      ...(notebook ? { notebook } : {}),
    },
  },
});

const notebookEntry = (name: string) => ({
  path: `${name}.yaml`,
  resource: {
    kind: "Notebook",
    metadata: { name, project: "default" },
    spec: { markdown: { inline: "# hi" } },
  },
});

describe("validateAlertNotebookLinks", () => {
  beforeEach(() => {
    dbNotebooks = [];
  });

  it("passes when the notebook is in the same apply batch", async () => {
    await expect(
      validateAlertNotebookLinks({
        orgId,
        repoid,
        alerts: [alertEntry("a.yaml", "a", "runbook")],
        notebooks: [notebookEntry("runbook")],
      }),
    ).resolves.toBeUndefined();
  });

  it("passes when the notebook already exists in the DB", async () => {
    dbNotebooks = [{ project: "default", slug: "runbook" }];
    await expect(
      validateAlertNotebookLinks({
        orgId,
        repoid,
        alerts: [alertEntry("a.yaml", "a", "runbook")],
        notebooks: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("throws when the linked notebook does not exist", async () => {
    await expect(
      validateAlertNotebookLinks({
        orgId,
        repoid,
        alerts: [alertEntry("a.yaml", "a", "missing")],
        notebooks: [],
      }),
    ).rejects.toBeInstanceOf(ApplyValidationError);
  });

  it("ignores alerts with no notebook", async () => {
    await expect(
      validateAlertNotebookLinks({
        orgId,
        repoid,
        alerts: [alertEntry("a.yaml", "a")],
        notebooks: [],
      }),
    ).resolves.toBeUndefined();
  });
});
