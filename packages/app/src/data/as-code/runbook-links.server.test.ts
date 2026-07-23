import { beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_REPO } from "@/data/alerts/annotations";
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
let ccRules: unknown[] = [];
let ccSlos: unknown[] = [];

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

vi.mock("@/data/cc/client", () => ({
  listAllRules: vi.fn(() => Promise.resolve(ccRules)),
  listSlos: vi.fn(() => Promise.resolve(ccSlos)),
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
      query: "SELECT 1",
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

function mockCcRules(rules: unknown[]): void {
  ccRules = rules;
}

function foreignRule(opts: { name: string; repoid: string; runbook: string }) {
  return {
    namespace: "",
    name: opts.name,
    spec: {
      severity: "info",
      for_secs: 0,
      resolve_after: 1,
      label_columns: [],
      value_column: null,
      suppressed: false,
      annotations: {
        [OWN_REPO]: opts.repoid,
        "everr.runbook": opts.runbook,
      },
    },
  };
}

describe("validateRunbookLinks", () => {
  beforeEach(() => {
    dbRunbooks = [];
    ccRules = [];
    ccSlos = [];
  });

  it("passes when the runbook is in the same apply batch", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({ runbook: "runbook" })],
        slos: [],
        runbooks: [runbookEntry("runbook")],
      }),
    ).resolves.toBeUndefined();
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

  it("accepts a ref to another repo's live runbook", async () => {
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
  });

  it("throws when the linked runbook does not exist", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({ runbook: "missing" })],
        slos: [],
        runbooks: [],
      }),
    ).rejects.toBeInstanceOf(ApplyValidationError);
  });

  it("ignores alerts with no runbook", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [alertEntry({})],
        slos: [],
        runbooks: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("validates SLO runbook refs through the same check", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [],
        slos: [sloEntry({ runbook: "missing" })],
        runbooks: [],
      }),
    ).rejects.toThrow(/missing/);
  });

  it("passes an SLO ref shipping in the same batch", async () => {
    await expect(
      validateRunbookLinks({
        namespace: live("repo-1"),
        alerts: [],
        slos: [sloEntry({ runbook: "runbook" })],
        runbooks: [runbookEntry("runbook")],
      }),
    ).resolves.toBeUndefined();
  });
});

describe("collectOrphanWarnings", () => {
  beforeEach(() => {
    dbRunbooks = [];
    ccRules = [];
    ccSlos = [];
  });

  it("warns when deleting a runbook another repo's alert links", async () => {
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    mockCcRules([
      foreignRule({
        name: "default/api-errors",
        repoid: "repo-2",
        runbook: "triage",
      }),
    ]);
    const warnings = await collectOrphanWarnings({
      namespace: live("repo-1"),
      runbooks: [], // batch no longer ships "triage": it will be pruned
    });
    expect(warnings).toEqual([
      expect.stringContaining('deleting runbook "default/triage"'),
    ]);
  });

  it("returns nothing for a preview namespace", async () => {
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    mockCcRules([
      foreignRule({
        name: "default/api-errors",
        repoid: "repo-2",
        runbook: "triage",
      }),
    ]);
    const warnings = await collectOrphanWarnings({
      namespace: { orgId, repoid: "repo-1", kind: "preview", id: "prev-1" },
      runbooks: [],
    });
    expect(warnings).toEqual([]);
  });

  it("does not warn when the runbook still ships in the batch", async () => {
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    mockCcRules([
      foreignRule({
        name: "default/api-errors",
        repoid: "repo-2",
        runbook: "triage",
      }),
    ]);
    const warnings = await collectOrphanWarnings({
      namespace: live("repo-1"),
      runbooks: [runbookEntry("triage")],
    });
    expect(warnings).toEqual([]);
  });

  it("does not warn about a repo's own link to its own deleted runbook", async () => {
    mockDbRunbookRows([
      { project: "default", slug: "triage", owner: "repo-1" },
    ]);
    mockCcRules([
      foreignRule({
        name: "default/api-errors",
        repoid: "repo-1",
        runbook: "triage",
      }),
    ]);
    const warnings = await collectOrphanWarnings({
      namespace: live("repo-1"),
      runbooks: [],
    });
    expect(warnings).toEqual([]);
  });
});
