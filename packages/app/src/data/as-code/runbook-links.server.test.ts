import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";

// A fake runbook row: identity plus the ownership/scope columns the real
// predicates (previewScope/foreignLiveScope) filter on. `owner` stands in for
// the row's repoid; `previewId` is undefined for a live row.
interface DbRow {
  project: string;
  slug: string;
  owner: string;
  organizationId?: string;
  previewId?: string | null;
}

let dbRunbooks: DbRow[] = [];
let alertingRules: unknown[] = [];
let alertingSlos: unknown[] = [];

// The mocked drizzle-orm operators below build a plain condition tree instead
// of a real SQL fragment (see the mock further down); this evaluates that
// tree against a fake row so the mocked `.where()` can actually apply
// previewScope/foreignLiveScope's ownership filtering rather than blindly
// returning every configured row. That distinction is exactly what the
// same-repo-vs-foreign-repo tests below depend on.
type Cond =
  | { op: "and"; conditions: Cond[] }
  | { op: "or"; conditions: Cond[] }
  | { op: "eq"; left: string; right: unknown }
  | { op: "ne"; left: string; right: unknown }
  | { op: "isNull"; col: string }
  | { op: "sql" };

function columnValue(column: string, row: DbRow): unknown {
  switch (column) {
    case "project":
      return row.project;
    case "slug":
      return row.slug;
    case "repoid":
      return row.owner;
    case "organization_id":
      return row.organizationId ?? orgId;
    case "preview_id":
      return row.previewId ?? null;
    default:
      return undefined;
  }
}

function evalCond(cond: Cond, row: DbRow): boolean {
  switch (cond.op) {
    case "and":
      return cond.conditions.every((c) => evalCond(c, row));
    case "or":
      return cond.conditions.some((c) => evalCond(c, row));
    case "eq":
      return columnValue(cond.left, row) === cond.right;
    case "ne":
      return columnValue(cond.left, row) !== cond.right;
    case "isNull":
      return columnValue(cond.col, row) == null;
    case "sql":
      return false;
  }
}

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn((cond: Cond) =>
      Promise.resolve(
        dbRunbooks
          .filter((row) => evalCond(cond, row))
          .map(({ project, slug }) => ({ project, slug })),
      ),
    ),
  };
  return { db: { select: vi.fn(() => selectChain) } };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
  ne: vi.fn((left: unknown, right: unknown) => ({ op: "ne", left, right })),
  or: vi.fn((...conditions: unknown[]) => ({ op: "or", conditions })),
  isNull: vi.fn((col: unknown) => ({ op: "isNull", col })),
  sql: Object.assign(() => ({ op: "sql" }), { raw: vi.fn() }),
}));

vi.mock("@/db/schema", () => ({
  runbooks: {
    organizationId: "organization_id",
    repoid: "repoid",
    previewId: "preview_id",
    project: "project",
    slug: "slug",
  },
}));

vi.mock("@/data/alerting/repository", () => ({
  listAllRules: vi.fn(() => Promise.resolve(alertingRules)),
  listSlos: vi.fn(() => Promise.resolve(alertingSlos)),
}));

import {
  collectOrphanWarnings,
  validateRunbookLinks,
} from "./runbook-links.server";

const orgId = "org-nb-links";

// A live namespace for the given repo.
const live = (repoid: string) => ({ orgId, repoid, kind: "live" }) as const;

const alertEntry = (opts: {
  runbook?: string;
  name?: string;
  project?: string;
}) => ({
  path: `${opts.name ?? "a"}.yaml`,
  resource: {
    kind: "AlertRule",
    metadata: {
      name: opts.name ?? "a",
      ...(opts.project ? { project: opts.project } : {}),
    },
    spec: {
      evaluationInterval: "1m",
      notificationMessage: { title: "t" },
      query: "SELECT 1 AS value",
      condition: { operator: "eq", threshold: 1 },
      ...(opts.runbook ? { runbook: opts.runbook } : {}),
    },
  },
});

const sloEntry = (opts: {
  runbook?: string;
  name?: string;
  project?: string;
}) => ({
  path: `${opts.name ?? "s"}.yaml`,
  resource: {
    kind: "SLO",
    metadata: {
      name: opts.name ?? "s",
      ...(opts.project ? { project: opts.project } : {}),
    },
    spec: {
      sli: {
        sql: "SELECT countIf(ok) AS good, count() AS valid FROM t WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}",
      },
      targetPercent: 99.9,
      timeWindow: "30d",
      ...(opts.runbook ? { runbook: opts.runbook } : {}),
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

function mockDbRunbookRows(
  rows: { project: string; slug: string; owner: string }[],
): void {
  dbRunbooks = rows.map((r) => ({ ...r, previewId: null }));
}

function mockAlertingRules(rules: unknown[]): void {
  alertingRules = rules;
}

function foreignRule(opts: { name: string; repoid: string; runbook: string }) {
  return {
    repoid: opts.repoid,
    previewId: null,
    name: opts.name,
    spec: {
      severity: "info",
      for_secs: 0,
      resolve_after: 1,
      label_columns: [],
      condition: { operator: "gt", threshold: 0 },
      suppressed: false,
      annotations: {
        "everr.runbook": opts.runbook,
      },
    },
  };
}

describe("validateRunbookLinks", () => {
  beforeEach(() => {
    dbRunbooks = [];
    alertingRules = [];
    alertingSlos = [];
  });

  it("passes when the alert's and SLO's runbook ships in the same batch, and ignores refless documents", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({ runbook: "runbook" }), alertEntry({ name: "b" })],
        slos: [sloEntry({ runbook: "runbook" })],
        runbooks: [runbookEntry("runbook")],
      }),
    ).resolves.toBeUndefined();

    // Nothing links a runbook at all: the check returns before any lookup.
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({})],
        slos: [],
        runbooks: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a ref that resolves to nothing, for alerts and for SLOs", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({ runbook: "missing" })],
        slos: [],
        runbooks: [],
      }),
    ).rejects.toBeInstanceOf(ApplyValidationError);
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [],
        slos: [sloEntry({ runbook: "missing" })],
        runbooks: [],
      }),
    ).rejects.toThrow(/linked runbook "default\/missing" does not exist/);
  });

  it("rejects a same-repo ref that is not in the batch even if a DB row exists", async () => {
    // The DB row belongs to THIS repo and is absent from the batch, so this
    // very apply would prune it: the ref must not resolve against it.
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({ runbook: "triage" })],
        slos: [],
        runbooks: [],
      }),
    ).rejects.toThrow(/does not exist/);
  });

  it("accepts a ref to another repo's live runbook, live and as a preview", async () => {
    // The same config must validate identically live and as a preview: a
    // foreign live runbook survives this repo's eventual live apply.
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-2" },
    ]);
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({ runbook: "triage" })],
        slos: [],
        runbooks: [],
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateRunbookLinks({
        namespace: { orgId, repoid: "repo-1", kind: "preview", id: "prev-1" },
        alerts: [alertEntry({ runbook: "triage" })],
        slos: [],
        runbooks: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a preview ref to this repo's own live runbook not in the batch", async () => {
    // Same prune reasoning as the live branch: merging this preview's config
    // would delete that runbook, so the ref must not resolve against it.
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    await expect(
      validateRunbookLinks({
        namespace: { orgId, repoid: "repo-1", kind: "preview", id: "prev-1" },
        alerts: [alertEntry({ runbook: "triage" })],
        slos: [],
        runbooks: [],
      }),
    ).rejects.toThrow(/does not exist/);
  });
});

describe("collectOrphanWarnings", () => {
  // This repo's live "triage" runbook, linked from another repo's alert: the
  // setup every case below varies one dimension of.
  beforeEach(() => {
    alertingSlos = [];
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    mockAlertingRules([
      foreignRule({
        name: "default/api-errors",
        repoid: "repo-2",
        runbook: "triage",
      }),
    ]);
  });

  it("warns when deleting a runbook another repo's alert links", async () => {
    const warnings = await collectOrphanWarnings({
      namespace: live("repo-1"),
      runbooks: [], // batch no longer ships "triage": it will be pruned
    });
    expect(warnings).toEqual([
      expect.stringContaining('deleting runbook "default/triage"'),
    ]);
  });

  it("stays quiet for a preview, for a runbook still in the batch, and for the repo's own link", async () => {
    // A preview namespace never prunes a live runbook.
    await expect(
      collectOrphanWarnings({
        namespace: { orgId, repoid: "repo-1", kind: "preview", id: "prev-1" },
        runbooks: [],
      }),
    ).resolves.toEqual([]);

    await expect(
      collectOrphanWarnings({
        namespace: live("repo-1"),
        runbooks: [runbookEntry("triage")],
      }),
    ).resolves.toEqual([]);

    // The link belongs to the applying repo itself: its own business.
    mockAlertingRules([
      foreignRule({
        name: "default/api-errors",
        repoid: "repo-1",
        runbook: "triage",
      }),
    ]);
    await expect(
      collectOrphanWarnings({ namespace: live("repo-1"), runbooks: [] }),
    ).resolves.toEqual([]);
  });
});
