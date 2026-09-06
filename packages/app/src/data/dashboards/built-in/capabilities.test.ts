import { describe, expect, it } from "vitest";
import * as z from "zod";
import {
  dashboardSlugSchema,
  dashboardSpecSchemaStrict,
  GRID_COLS,
} from "../schema";
import {
  buildCapabilitiesQuery,
  CATALOG_PROBES,
  decodeCapabilityRows,
  EMPTY_CAPABILITIES,
  evaluateBuiltin,
  probeKey,
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

describe("CATALOG_PROBES", () => {
  it("asks each distinct catalog requirement exactly once", () => {
    const stated = BUILTIN_DASHBOARDS.flatMap((b) => b.requires).map(probeKey);
    const asked = CATALOG_PROBES.map(probeKey);
    expect(new Set(asked).size).toBe(asked.length);
    expect([...asked].sort()).toEqual([...new Set(stated)].sort());
  });
});

describe("buildCapabilitiesQuery", () => {
  // `mapContains` is the shape the tables' bloom_filter key indexes can
  // prune, so an absent attribute reads zero granules instead of the window.
  it("probes a trace attribute with the index-prunable mapContains", () => {
    expect(
      buildCapabilitiesQuery([{ signal: "traces", match: "faas.trigger" }]),
    ).toBe(
      "SELECT DISTINCT key FROM (\n  " +
        "SELECT 'traces:faas.trigger' AS key FROM traces WHERE " +
        "Timestamp >= parseDateTime64BestEffort({from:String}, 9) AND " +
        "Timestamp <= parseDateTime64BestEffort({to:String}, 9) AND " +
        "mapContains(SpanAttributes, 'faas.trigger') LIMIT 1\n)",
    );
  });

  it("probes a log attribute on its own time column", () => {
    expect(
      buildCapabilitiesQuery([
        { signal: "logs", match: "browser.web_vital.value" },
      ]),
    ).toBe(
      "SELECT DISTINCT key FROM (\n  " +
        "SELECT 'logs:browser.web_vital.value' AS key FROM logs WHERE " +
        "Timestamp >= parseDateTime64BestEffort({from:String}, 9) AND " +
        "Timestamp <= parseDateTime64BestEffort({to:String}, 9) AND " +
        "mapContains(LogAttributes, 'browser.web_vital.value') LIMIT 1\n)",
    );
  });

  // Written out rather than filtered from `SQL_API_TENANT_TABLES`: the suite
  // setup mocks `@/lib/clickhouse`, so the real list is not importable here.
  // A metric requirement is one branch per table, and the prefix stays in the
  // WHERE so `MetricName` (the third ORDER BY column) can prune granules.
  it("probes every metric table, keeping the prefix in the WHERE", () => {
    const sql = buildCapabilitiesQuery([{ signal: "metrics", match: "redis" }]);
    const branches = sql.split("\n  UNION ALL\n  ");
    expect(branches).toHaveLength(5);
    for (const table of [
      "metrics_gauge",
      "metrics_sum",
      "metrics_histogram",
      "metrics_exponential_histogram",
      "metrics_summary",
    ]) {
      expect(sql).toContain(
        `SELECT 'metrics:redis' AS key FROM ${table} WHERE ` +
          "TimeUnix >= parseDateTimeBestEffort({from:String}) AND " +
          "TimeUnix <= parseDateTimeBestEffort({to:String}) AND " +
          "(MetricName = 'redis' OR startsWith(MetricName, 'redis.')) LIMIT 1",
      );
    }
  });

  // A namespace can't be proven absent by the key bloom filter, so a prefix
  // attribute match would scan the window on every probe: banned outright.
  it("refuses a prefix attribute match", () => {
    expect(() =>
      buildCapabilitiesQuery([{ signal: "logs", match: "redis." }]),
    ).toThrow(/exact key, not a prefix/);
  });

  it("asks bare existence without a name predicate", () => {
    expect(buildCapabilitiesQuery([{ signal: "traces" }])).toBe(
      "SELECT DISTINCT key FROM (\n  " +
        "SELECT 'traces' AS key FROM traces WHERE " +
        "Timestamp >= parseDateTime64BestEffort({from:String}, 9) AND " +
        "Timestamp <= parseDateTime64BestEffort({to:String}, 9) LIMIT 1\n)",
    );
  });

  it("refuses a match it cannot safely inline", () => {
    expect(() =>
      buildCapabilitiesQuery([{ signal: "traces", match: "x' OR '1" }]),
    ).toThrow(/Unsupported capability match/);
  });

  it("refuses a signal outside the schema instead of interpolating it", () => {
    expect(() =>
      buildCapabilitiesQuery([
        // The catalog YAML is cast, not validated, on load, so an unknown
        // signal can reach the builder at runtime despite the types.
        { signal: "spans; DROP TABLE traces" as never },
      ]),
    ).toThrow(/Unsupported capability signal/);
  });
});

describe("decodeCapabilityRows", () => {
  it("deduplicates the met probe keys", () => {
    expect(
      decodeCapabilityRows([
        { key: "metrics" },
        { key: "metrics" },
        { key: "metrics:redis" },
        { key: "traces" },
      ]),
    ).toEqual(["metrics", "metrics:redis", "traces"]);
  });

  it("is empty when nothing came back", () => {
    expect(decodeCapabilityRows([])).toEqual(EMPTY_CAPABILITIES);
  });
});

describe("evaluateBuiltin", () => {
  it("is ready when every requirement is met", () => {
    expect(
      evaluateBuiltin(template([{ signal: "traces", label: "no traces" }]), [
        "traces",
      ]),
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

  it("does not let a signal's bare probe satisfy a match", () => {
    expect(
      evaluateBuiltin(
        template([{ signal: "metrics", match: "redis", label: "no redis.*" }]),
        ["metrics"],
      ),
    ).toEqual({ status: "needs-setup", missing: ["no redis.*"] });
  });

  it("reads each requirement from its own signal", () => {
    // A metric named `http.route` must not satisfy a trace-attribute
    // requirement.
    expect(
      evaluateBuiltin(
        template([
          { signal: "traces", match: "http.route", label: "no http.*" },
        ]),
        ["metrics", "metrics:http.route"],
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
