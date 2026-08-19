import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  dashboardSlugSchema,
  dashboardSpecSchemaStrict,
  GRID_COLS,
} from "../schema";
import {
  buildCapabilitiesQuery,
  decodeCapabilityRows,
  EMPTY_CAPABILITIES,
  evaluateBuiltin,
  type TelemetryCapabilities,
} from "./capabilities";
import { BUILTIN_DASHBOARDS } from "./catalog";
import { BUILTIN_CATEGORIES, type BuiltinDashboard, SIGNALS } from "./types";

const template = (
  requires: BuiltinDashboard["requires"],
): BuiltinDashboard => ({
  id: "t",
  name: "T",
  description: "",
  category: "Application",
  requires,
  document: {
    kind: "Dashboard",
    metadata: { name: "t" },
    spec: { panels: {}, layouts: [] },
  },
});

const capabilities = (
  overrides: Partial<TelemetryCapabilities>,
): TelemetryCapabilities => ({ ...EMPTY_CAPABILITIES, ...overrides });

describe("buildCapabilitiesQuery", () => {
  const sql = buildCapabilitiesQuery();

  it("binds the same {from}/{to} parameters panel queries get", () => {
    expect(sql).toContain("{from:String}");
    expect(sql).toContain("{to:String}");
  });

  it("probes traces and logs for existence rather than counting", () => {
    expect(sql).toContain("'traces' AS signal, '' AS name");
    expect(sql).toContain("'logs' AS signal, '' AS name");
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).not.toContain("count()");
  });

  // Metrics existence has no probe of its own; decodeCapabilityRows derives it
  // from this scan, so the scan must cover every table the tenant can read.
  it("scans metric names from every metric table the tenant can read", () => {
    // Written out rather than filtered from `SQL_API_TENANT_TABLES`: the suite
    // setup mocks `@/lib/clickhouse`, so the real list is not importable here.
    for (const table of [
      "metrics_gauge",
      "metrics_sum",
      "metrics_histogram",
      "metrics_exponential_histogram",
      "metrics_summary",
    ]) {
      expect(sql).toContain(
        `SELECT DISTINCT toString(MetricName) AS name FROM ${table} WHERE TimeUnix >=`,
      );
    }
    expect(sql).not.toContain("'metrics' AS signal, ''");
  });

  it("uses each table's own time column", () => {
    expect(sql).toContain("TimestampTime >=");
    expect(sql).toContain("TimeUnix >=");
    expect(sql).toContain("Timestamp >=");
  });
});

describe("decodeCapabilityRows", () => {
  it("buckets rows by signal, deduplicated and sorted", () => {
    expect(
      decodeCapabilityRows([
        { signal: "traces", name: "" },
        { signal: "traces", name: "http.route" },
        { signal: "traces", name: "http.route" },
        { signal: "metrics", name: "redis.memory.used" },
        { signal: "logs", name: "session.id" },
      ]),
    ).toEqual({
      traces: { present: true, names: ["http.route"] },
      logs: { present: true, names: ["session.id"] },
      metrics: { present: true, names: ["redis.memory.used"] },
    });
  });

  it("treats a bare existence row as presence without names", () => {
    expect(decodeCapabilityRows([{ signal: "traces", name: "" }])).toEqual(
      capabilities({ traces: { present: true, names: [] } }),
    );
  });

  it("derives metrics presence from the metric-name scan", () => {
    expect(
      decodeCapabilityRows([{ signal: "metrics", name: "jvm.memory.used" }])
        .metrics,
    ).toEqual({ present: true, names: ["jvm.memory.used"] });
  });

  it("ignores rows with an unknown signal", () => {
    expect(decodeCapabilityRows([{ signal: "nonsense", name: "x" }])).toEqual(
      EMPTY_CAPABILITIES,
    );
  });
});

describe("evaluateBuiltin", () => {
  it("is ready when every requirement is met", () => {
    expect(
      evaluateBuiltin(
        template([{ signal: "traces", label: "no traces" }]),
        capabilities({ traces: { present: true, names: [] } }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("reports every unmet requirement by its label", () => {
    expect(
      evaluateBuiltin(
        template([
          { signal: "metrics", label: "no metrics" },
          { signal: "metrics", match: "redis", label: "no redis.*" },
        ]),
        EMPTY_CAPABILITIES,
      ),
    ).toEqual({ status: "needs-setup", missing: ["no metrics", "no redis.*"] });
  });

  it("matches a namespace prefix", () => {
    expect(
      evaluateBuiltin(
        template([{ signal: "metrics", match: "redis", label: "no redis.*" }]),
        capabilities({
          metrics: { present: true, names: ["redis.memory.used"] },
        }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("does not let a substring claim credit for a namespace", () => {
    expect(
      evaluateBuiltin(
        template([{ signal: "metrics", match: "redis", label: "no redis.*" }]),
        capabilities({
          metrics: { present: true, names: ["myredis.memory.used"] },
        }),
      ),
    ).toEqual({ status: "needs-setup", missing: ["no redis.*"] });
  });

  it("matches an exact key with no namespace below it", () => {
    expect(
      evaluateBuiltin(
        template([
          {
            signal: "traces",
            match: "http.request.method",
            label: "no http.request.method*",
          },
        ]),
        capabilities({
          traces: { present: true, names: ["http.request.method"] },
        }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("reads each requirement from its own signal", () => {
    // A metric named `http.route` must not satisfy a trace-attribute
    // requirement.
    expect(
      evaluateBuiltin(
        template([
          { signal: "traces", match: "http.route", label: "no http.*" },
        ]),
        capabilities({ metrics: { present: true, names: ["http.route"] } }),
      ),
    ).toEqual({ status: "needs-setup", missing: ["no http.*"] });
  });

  it("deduplicates repeated labels", () => {
    expect(
      evaluateBuiltin(
        template([
          { signal: "metrics", label: "no metrics" },
          { signal: "metrics", match: "jvm", label: "no metrics" },
        ]),
        EMPTY_CAPABILITIES,
      ),
    ).toEqual({ status: "needs-setup", missing: ["no metrics"] });
  });

  it("is ready with no requirements at all", () => {
    expect(evaluateBuiltin(template([]), EMPTY_CAPABILITIES)).toEqual({
      status: "ready",
    });
  });
});

/**
 * The catalog envelope around each dashboard document. The YAML is cast with
 * `as BuiltinDashboard` at parse time, so this is the only place a typo'd
 * `signal`, `category` or a missing `label` gets caught before it crashes
 * `evaluateBuiltin` at runtime.
 */
const builtinDashboardSchema = z.strictObject({
  // The id is the slug in `/dashboards/built-in/$slug` and in `everr
  // resources show`, so it answers to the same rule every as-code slug does.
  id: dashboardSlugSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  category: z.enum(BUILTIN_CATEGORIES),
  requires: z.array(
    z.strictObject({
      signal: z.enum(SIGNALS),
      match: z.string().min(1).optional(),
      label: z.string().min(1),
    }),
  ),
  document: z.strictObject({
    kind: z.literal("Dashboard"),
    metadata: z.strictObject({
      name: z.string(),
      project: z.string().optional(),
    }),
    // The same strict schema `everr apply` uses, so a builtin that would be
    // rejected as a file is rejected here too.
    spec: dashboardSpecSchemaStrict,
  }),
});

function validateCatalog(): void {
  const ids = new Set<string>();
  for (const builtin of BUILTIN_DASHBOARDS) {
    if (ids.has(builtin.id)) {
      throw new Error(`Duplicate builtin id: ${builtin.id}`);
    }
    ids.add(builtin.id);
    builtinDashboardSchema.parse(builtin);
  }
}

describe("catalog", () => {
  it("validates against the same strict schema everr apply uses", () => {
    expect(() => validateCatalog()).not.toThrow();
  });

  it("names each document after its id", () => {
    // The id's slug shape is asserted by validateCatalog above, which parses it
    // with the same schema the as-code write path uses.
    for (const t of BUILTIN_DASHBOARDS) {
      expect(t.document.metadata.name).toBe(t.id);
    }
  });

  it("declares at least one requirement per template", () => {
    // Readiness is the gallery's whole promise; a template that requires
    // nothing would always claim ready and could still render empty.
    for (const t of BUILTIN_DASHBOARDS) {
      expect(t.requires.length).toBeGreaterThan(0);
    }
  });

  it("lays every panel out exactly once, within the grid width", () => {
    for (const t of BUILTIN_DASHBOARDS) {
      const refs = t.document.spec.layouts.flatMap((l) =>
        l.spec.items.map((i) => i.content.$ref.split("/").pop()),
      );
      expect(new Set(refs).size).toBe(refs.length);
      expect([...refs].sort()).toEqual(
        Object.keys(t.document.spec.panels).sort(),
      );
      for (const item of t.document.spec.layouts[0]?.spec.items ?? []) {
        expect(item.x + item.width).toBeLessThanOrEqual(GRID_COLS);
      }
    }
  });
});
