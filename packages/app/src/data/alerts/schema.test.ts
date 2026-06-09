import { describe, expect, it } from "vitest";
import {
  parseAlertResourceFile,
  parseAlertResourceFiles,
  renderAlertRuleQuery,
} from "./schema";

const validRule = `
kind: AlertRule
metadata:
  name: high-5xx-routes
  project: platform
  labels:
    team: platform
spec:
  severity: critical
  evaluationInterval: 1m
  window: 5m
  summary: "\${row_count} routes have elevated 5xxs"
  description: "Top route: \${top_route}"
  query: |
    SELECT 1 AS ok
`;

describe("alert resource schema", () => {
  it("parses an AlertRule and defaults metadata.project", () => {
    const parsed = parseAlertResourceFile({
      path: "alerts/high-5xx.yaml",
      content: validRule.replace("  project: platform\n", ""),
    });

    expect(parsed.resource.kind).toBe("AlertRule");
    if (parsed.resource.kind !== "AlertRule") throw new Error("wrong kind");
    expect(parsed.resource.metadata.project).toBe("default");
    expect(parsed.resource.metadata.name).toBe("high-5xx-routes");
    expect(parsed.resource.spec.severity).toBe("critical");
  });

  it("parses a single AlertSettings resource", () => {
    const parsed = parseAlertResourceFiles([
      {
        path: "alerts/settings.yaml",
        content: `
kind: AlertSettings
spec:
  notificationDelivery:
    email:
      enabled: true
      to:
        - alerts@example.com
    telegram:
      enabled: false
      chatIds: []
`,
      },
    ]);

    expect(parsed.settings?.path).toBe("alerts/settings.yaml");
    expect(parsed.rules).toEqual([]);
  });

  it("rejects duplicate alert names within a project", () => {
    expect(() =>
      parseAlertResourceFiles([
        { path: "alerts/a.yaml", content: validRule },
        { path: "alerts/b.yaml", content: validRule },
      ]),
    ).toThrow(
      /Duplicate AlertRule metadata.name "high-5xx-routes" in project "platform"/,
    );
  });

  it("allows the same alert name in different projects", () => {
    const parsed = parseAlertResourceFiles([
      { path: "alerts/a.yaml", content: validRule },
      {
        path: "alerts/b.yaml",
        content: validRule.replace("project: platform", "project: payments"),
      },
    ]);

    expect(parsed.rules.map((rule) => rule.resource.metadata.project)).toEqual([
      "platform",
      "payments",
    ]);
  });

  it("rejects unknown variables in summary, description, and query", () => {
    expect(() =>
      parseAlertResourceFile({
        path: "alerts/bad.yaml",
        content: validRule.replace(`\${row_count}`, `\${not_allowed}`),
      }),
    ).toThrow(/Unsupported alert variable "\${not_allowed}"/);
  });

  it("renders the window variable as a ClickHouse interval fragment", () => {
    const parsed = parseAlertResourceFile({
      path: "alerts/high-5xx.yaml",
      content: validRule.replace(
        "SELECT 1 AS ok",
        `SELECT now() - INTERVAL \${window} AS cutoff`,
      ),
    });

    if (parsed.resource.kind !== "AlertRule") throw new Error("wrong kind");

    expect(renderAlertRuleQuery(parsed.resource)).toBe(
      "SELECT now() - INTERVAL 5 MINUTE AS cutoff\n",
    );
  });

  it("rejects evaluation intervals below one minute", () => {
    expect(() =>
      parseAlertResourceFile({
        path: "alerts/bad.yaml",
        content: validRule.replace(
          "evaluationInterval: 1m",
          "evaluationInterval: 30s",
        ),
      }),
    ).toThrow(/evaluationInterval must be at least 1m/);
  });
});
