import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundEvidenceRows,
  parseAlertYaml,
  renderAlertQuery,
  validateTemplate,
} from "./parser";

const fixtureDir = join(__dirname, "__fixtures__");

describe("alert YAML parser", () => {
  it("parses a valid alert file", () => {
    const yaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");

    const parsed = parseAlertYaml(yaml);

    expect(parsed.service).toBe("api");
    expect(parsed.alerts).toHaveLength(1);
    expect(parsed.alerts[0]).toMatchObject({
      name: "high-5xx-routes",
      severity: "critical",
      routing: "admins",
      evaluationIntervalSeconds: 60,
      windowSeconds: 300,
    });
  });

  it("rejects unsupported severity and sub-minute intervals", () => {
    const yaml = readFileSync(join(fixtureDir, "invalid-alerts.yaml"), "utf8");

    expect(() => parseAlertYaml(yaml)).toThrow(/severity|evaluationInterval/);
  });

  it("renders ClickHouse interval fragments from validated windows", () => {
    const yaml = readFileSync(join(fixtureDir, "valid-alerts.yaml"), "utf8");
    const parsed = parseAlertYaml(yaml);

    const query = renderAlertQuery(parsed.alerts[0]);

    expect(query).toContain("INTERVAL 5 MINUTE");
    expect(query).not.toContain("{{ window }}");
  });

  it("validates supported row templates", () => {
    expect(() =>
      validateTemplate("{{ rows.length }} failures in {{ service }}"),
    ).not.toThrow();
    expect(() => validateTemplate("{{ rows.0.route }}")).not.toThrow();
    expect(() => validateTemplate("{{ constructor.name }}")).toThrow(
      /unsupported template path/,
    );
  });

  it("bounds evidence rows by count and byte size", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      route: `/route-${i}`,
      value: "x".repeat(2048),
    }));

    const bounded = boundEvidenceRows(rows, {
      maxRows: 50,
      maxBytes: 64 * 1024,
    });

    expect(bounded.rows.length).toBeLessThanOrEqual(50);
    expect(bounded.truncated).toBe(true);
    expect(
      Buffer.byteLength(JSON.stringify(bounded.rows), "utf8"),
    ).toBeLessThanOrEqual(64 * 1024);
  });
});
