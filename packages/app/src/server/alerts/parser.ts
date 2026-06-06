import { parse as parseYaml } from "yaml";
import { RawAlertFileSchema } from "./schema";

export type ParsedAlertFile = {
  version: "everr/v1";
  service: string;
  labels: Record<string, string>;
  alerts: ParsedAlertDefinition[];
};

export type ParsedAlertDefinition = {
  service: string;
  name: string;
  severity: "critical" | "warning";
  routing: string;
  evaluationInterval: string;
  evaluationIntervalSeconds: number;
  window: string;
  windowSeconds: number;
  windowClickHouseInterval: string;
  summary: string;
  description: string | null;
  query: string;
  labels: Record<string, string>;
};

type EvidenceBounds = {
  maxRows: number;
  maxBytes: number;
};

const DEFAULT_EVIDENCE_BOUNDS = {
  maxRows: 50,
  maxBytes: 64 * 1024,
} satisfies EvidenceBounds;

const DURATION_PATTERN = /^([1-9]\d*)([mhd])$/;
const TEMPLATE_PATTERN = /{{\s*([^}]+?)\s*}}/g;
const SUPPORTED_TEMPLATE_PATHS = new Set([
  "rows.length",
  "service",
  "name",
  "severity",
  "routing",
]);

export function parseAlertYaml(rawYaml: string): ParsedAlertFile {
  const raw = parseYaml(rawYaml);
  const parsed = RawAlertFileSchema.safeParse(raw);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
        return `${path}${issue.message}`;
      })
      .join("; ");
    throw new Error(`Invalid alert YAML: ${message}`);
  }

  return {
    version: parsed.data.version,
    service: parsed.data.service,
    labels: parsed.data.labels,
    alerts: parsed.data.alerts.map((alert) => {
      const evaluationInterval = parseDuration(
        alert.evaluationInterval,
        "evaluationInterval",
      );
      if (evaluationInterval.seconds < 60) {
        throw new Error("evaluationInterval must be at least 1m");
      }

      const window = parseDuration(alert.window, "window");
      validateTemplate(alert.summary);
      if (alert.description) {
        validateTemplate(alert.description);
      }

      return {
        service: parsed.data.service,
        name: alert.name,
        severity: alert.severity,
        routing: alert.routing,
        evaluationInterval: alert.evaluationInterval,
        evaluationIntervalSeconds: evaluationInterval.seconds,
        window: alert.window,
        windowSeconds: window.seconds,
        windowClickHouseInterval: window.clickhouseInterval,
        summary: alert.summary,
        description: alert.description ?? null,
        query: alert.query,
        labels: parsed.data.labels,
      };
    }),
  };
}

export function renderAlertQuery(alert: ParsedAlertDefinition): string {
  return alert.query.replace(
    /{{\s*window\s*}}/g,
    alert.windowClickHouseInterval,
  );
}

export function validateTemplate(template: string): void {
  for (const match of template.matchAll(TEMPLATE_PATTERN)) {
    const path = match[1].trim();
    if (SUPPORTED_TEMPLATE_PATHS.has(path)) {
      continue;
    }

    if (/^rows\.\d+\.[A-Za-z_][A-Za-z0-9_]*$/.test(path)) {
      continue;
    }

    throw new Error(`unsupported template path: ${path}`);
  }
}

export function boundEvidenceRows(
  rows: Array<Record<string, unknown>>,
  limits: EvidenceBounds = DEFAULT_EVIDENCE_BOUNDS,
): { rows: Array<Record<string, unknown>>; truncated: boolean } {
  const originalLength = rows.length;
  const bounded = rows.slice(0, limits.maxRows);

  while (
    bounded.length > 0 &&
    Buffer.byteLength(JSON.stringify(bounded), "utf8") > limits.maxBytes
  ) {
    bounded.pop();
  }

  return {
    rows: bounded,
    truncated: bounded.length < originalLength,
  };
}

function parseDuration(
  input: string,
  field: "evaluationInterval" | "window",
): { seconds: number; clickhouseInterval: string } {
  const match = DURATION_PATTERN.exec(input);
  if (!match) {
    throw new Error(`${field} must use m, h, or d duration syntax`);
  }

  const value = Number(match[1]);
  const unit = match[2] as "m" | "h" | "d";

  switch (unit) {
    case "m":
      return {
        seconds: value * 60,
        clickhouseInterval: `${value} MINUTE`,
      };
    case "h":
      return {
        seconds: value * 60 * 60,
        clickhouseInterval: `${value} HOUR`,
      };
    case "d":
      return {
        seconds: value * 24 * 60 * 60,
        clickhouseInterval: `${value} DAY`,
      };
  }
}
