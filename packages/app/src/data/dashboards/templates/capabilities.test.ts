import { describe, expect, it } from "vitest";
import {
  buildCapabilitiesQuery,
  decodeCapabilityRows,
  EMPTY_CAPABILITIES,
  evaluateTemplate,
  type TelemetryCapabilities,
} from "./capabilities";
import { DASHBOARD_TEMPLATES, validateCatalog } from "./catalog";
import type { DashboardTemplate } from "./types";

const template = (
  requires: DashboardTemplate["requires"],
): DashboardTemplate => ({
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

  it("reads metric names from the gauge and sum tables", () => {
    expect(sql).toContain("FROM metrics_gauge");
    expect(sql).toContain("FROM metrics_sum");
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
        { kind: "resource-attribute", name: "service.name" },
      ]),
    ).toEqual({
      signals: ["traces"],
      metricNames: ["redis.memory.used"],
      spanAttributeKeys: ["http.route"],
      logAttributeKeys: ["session.id"],
      resourceAttributeKeys: ["service.name"],
    });
  });

  it("ignores rows with an unknown kind", () => {
    expect(decodeCapabilityRows([{ kind: "nonsense", name: "x" }])).toEqual(
      EMPTY_CAPABILITIES,
    );
  });
});

describe("evaluateTemplate", () => {
  it("is ready when every requirement is met", () => {
    expect(
      evaluateTemplate(
        template([{ kind: "signal", match: "traces", label: "no traces" }]),
        capabilities({ signals: ["traces"] }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("reports every unmet requirement by its label", () => {
    expect(
      evaluateTemplate(
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
      evaluateTemplate(
        template([{ kind: "metric", match: "redis", label: "no redis.*" }]),
        capabilities({ metricNames: ["redis.memory.used"] }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("does not let a substring claim credit for a namespace", () => {
    expect(
      evaluateTemplate(
        template([{ kind: "metric", match: "redis", label: "no redis.*" }]),
        capabilities({ metricNames: ["myredis.memory.used"] }),
      ),
    ).toEqual({ status: "needs-setup", missing: ["no redis.*"] });
  });

  it("matches an exact key with no namespace below it", () => {
    expect(
      evaluateTemplate(
        template([
          {
            kind: "span-attribute",
            match: "http.request.method",
            label: "no http.request.method*",
          },
        ]),
        capabilities({ spanAttributeKeys: ["http.request.method"] }),
      ),
    ).toEqual({ status: "ready" });
  });

  it("reads each requirement from its own bucket", () => {
    // A metric named `http.route` must not satisfy a span-attribute requirement.
    expect(
      evaluateTemplate(
        template([
          { kind: "span-attribute", match: "http.route", label: "no http.*" },
        ]),
        capabilities({ metricNames: ["http.route"] }),
      ),
    ).toEqual({ status: "needs-setup", missing: ["no http.*"] });
  });

  it("deduplicates repeated labels", () => {
    expect(
      evaluateTemplate(
        template([
          { kind: "signal", match: "metrics", label: "no metrics" },
          { kind: "metric", match: "jvm", label: "no metrics" },
        ]),
        EMPTY_CAPABILITIES,
      ),
    ).toEqual({ status: "needs-setup", missing: ["no metrics"] });
  });

  it("is ready with no requirements at all", () => {
    expect(evaluateTemplate(template([]), EMPTY_CAPABILITIES)).toEqual({
      status: "ready",
    });
  });
});

describe("catalog", () => {
  it("validates against the same strict schema everr apply uses", () => {
    expect(() => validateCatalog()).not.toThrow();
  });

  it("gives every template a slug-shaped id matching its document name", () => {
    for (const t of DASHBOARD_TEMPLATES) {
      expect(t.id).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
      expect(t.document.metadata.name).toBe(t.id);
    }
  });

  it("declares at least one requirement per template", () => {
    // Readiness is the gallery's whole promise; a template that requires
    // nothing would always claim ready and could still render empty.
    for (const t of DASHBOARD_TEMPLATES) {
      expect(t.requires.length).toBeGreaterThan(0);
    }
  });

  it("lays every panel out exactly once, within the grid width", () => {
    for (const t of DASHBOARD_TEMPLATES) {
      const refs = t.document.spec.layouts.flatMap((l) =>
        l.spec.items.map((i) => i.content.$ref.split("/").pop()),
      );
      expect(new Set(refs).size).toBe(refs.length);
      expect([...refs].sort()).toEqual(
        Object.keys(t.document.spec.panels).sort(),
      );
      for (const item of t.document.spec.layouts[0]?.spec.items ?? []) {
        expect(item.x + item.width).toBeLessThanOrEqual(24);
      }
    }
  });
});
