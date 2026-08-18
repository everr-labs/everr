import { describe, expect, it } from "vitest";
import { GRID_COLS } from "../schema";
import {
  buildCapabilitiesQuery,
  decodeCapabilityRows,
  EMPTY_CAPABILITIES,
  evaluateBuiltin,
  type TelemetryCapabilities,
} from "./capabilities";
import { BUILTIN_DASHBOARDS, validateCatalog } from "./catalog";
import type { BuiltinDashboard } from "./types";

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

  it("probes each signal for existence rather than counting", () => {
    expect(sql).toContain("'signal' AS kind, 'traces' AS name");
    expect(sql).toContain("'signal' AS kind, 'logs' AS name");
    expect(sql).toMatch(/LIMIT 1/);
    expect(sql).not.toContain("count()");
  });

  // Both, not one: widening the existence probe alone would report metrics and
  // still hold back every metric template, because no name reached the scan.
  it("probes and scans every metric table the tenant can read", () => {
    // Written out rather than filtered from `SQL_API_TENANT_TABLES`: the suite
    // setup mocks `@/lib/clickhouse`, so the real list is not importable here.
    for (const table of [
      "metrics_gauge",
      "metrics_sum",
      "metrics_histogram",
      "metrics_exponential_histogram",
      "metrics_summary",
    ]) {
      expect(sql).toContain(`FROM ${table} WHERE TimeUnix >=`);
      expect(sql).toContain(`SELECT DISTINCT MetricName FROM ${table}`);
    }
  });

  it("uses each table's own time column", () => {
    expect(sql).toContain("TimestampTime >=");
    expect(sql).toContain("TimeUnix >=");
    expect(sql).toContain("Timestamp >=");
  });
});

describe("decodeCapabilityRows", () => {
  it("buckets rows by kind, deduplicated and sorted", () => {
    expect(
      decodeCapabilityRows([
        { kind: "signal", name: "traces" },
        { kind: "signal", name: "traces" },
        { kind: "metric", name: "redis.memory.used" },
        { kind: "span-attribute", name: "http.route" },
        { kind: "log-attribute", name: "session.id" },
      ]),
    ).toEqual({
      signal: ["traces"],
      metric: ["redis.memory.used"],
      "span-attribute": ["http.route"],
      "log-attribute": ["session.id"],
    });
  });

  it("ignores rows with an unknown kind", () => {
    expect(decodeCapabilityRows([{ kind: "nonsense", name: "x" }])).toEqual(
      EMPTY_CAPABILITIES,
    );
  });
});

describe("evaluateBuiltin", () => {
  it("is ready when every requirement is met", () => {
    expect(
      evaluateBuiltin(
        template([{ kind: "signal", match: "traces", label: "no traces" }]),
        capabilities({ signal: ["traces"] }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("reports every unmet requirement by its label", () => {
    expect(
      evaluateBuiltin(
        template([
          { kind: "signal", match: "metrics", label: "no metrics" },
          { kind: "metric", match: "redis", label: "no redis.*" },
        ]),
        EMPTY_CAPABILITIES,
      ),
    ).toEqual({ status: "needs-setup", missing: ["no metrics", "no redis.*"] });
  });

  it("matches a namespace prefix", () => {
    expect(
      evaluateBuiltin(
        template([{ kind: "metric", match: "redis", label: "no redis.*" }]),
        capabilities({ metric: ["redis.memory.used"] }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("does not let a substring claim credit for a namespace", () => {
    expect(
      evaluateBuiltin(
        template([{ kind: "metric", match: "redis", label: "no redis.*" }]),
        capabilities({ metric: ["myredis.memory.used"] }),
      ),
    ).toEqual({ status: "needs-setup", missing: ["no redis.*"] });
  });

  it("matches an exact key with no namespace below it", () => {
    expect(
      evaluateBuiltin(
        template([
          {
            kind: "span-attribute",
            match: "http.request.method",
            label: "no http.request.method*",
          },
        ]),
        capabilities({ "span-attribute": ["http.request.method"] }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("reads each requirement from its own bucket", () => {
    // A metric named `http.route` must not satisfy a span-attribute requirement.
    expect(
      evaluateBuiltin(
        template([
          { kind: "span-attribute", match: "http.route", label: "no http.*" },
        ]),
        capabilities({ metric: ["http.route"] }),
      ),
    ).toEqual({ status: "needs-setup", missing: ["no http.*"] });
  });

  it("deduplicates repeated labels", () => {
    expect(
      evaluateBuiltin(
        template([
          { kind: "signal", match: "metrics", label: "no metrics" },
          { kind: "metric", match: "jvm", label: "no metrics" },
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
