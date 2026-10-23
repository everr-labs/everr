import type { UsefulConsultation } from "#app/organizations/consultations.ts";
import { consultations } from "#app/server/organizations/consultations.ts";
import { serverLogger } from "#app/telemetry/logger.ts";

export type ConsultationPrincipal = UsefulConsultation["principal"];
type TraceRecord = {
  traceId: string;
  serviceName: string;
  resourceAttributes: unknown;
  spanAttributes: unknown;
};

// This is deliberately a complete, small grammar, not a SQL classifier. A raw
// table read cannot manufacture ResourceAttributes through aliases or constants.
// All other valid SQL still runs normally, without claiming activation evidence.
const traceDetailSql =
  /^\s*SELECT\s+\*\s+FROM\s+traces\s+WHERE\s+TraceId\s*=\s*'([a-f\d]{32})'(?:\s+AND\s+ServiceName\s*=\s*'[\w.-]+'\s+AND\s+Timestamp\s*>=\s*'[^'\\]+'\s+AND\s+Timestamp\s*<\s*'[^'\\]+')?\s+(?:ORDER\s+BY\s+Timestamp(?:\s+(?:ASC|DESC))?\s+)?LIMIT\s+([1-9]\d{0,3})\s*;?\s*$/i;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

function rawAttribute(value: unknown, key: string): unknown {
  const attributes = record(value);
  if (!attributes) return undefined;
  let current: unknown = attributes[key];
  if (current === undefined) {
    current = attributes;
    for (const part of key.split(".")) current = record(current)?.[part];
  }
  return current;
}

function attribute(value: unknown, key: string): string {
  const current = rawAttribute(value, key);
  return typeof current === "string" || typeof current === "number" ? String(current) : "";
}

function excludedAttributes(value: unknown): boolean {
  const attributes = record(value);
  if (!attributes) return false;
  return Object.entries(attributes).some(([key, item]) => {
    if (/(?:^|\.)(?:test|testdata|test_data|demo|synthetic|internal)(?:\.|$)/i.test(key)) {
      return item !== false && item !== "false" && item !== 0 && item !== "0" && item !== "";
    }
    return typeof item === "object" && item !== null && excludedAttributes(item);
  });
}

function origin(row: TraceRecord): "production" | "ci" | undefined {
  const resource = row.resourceAttributes;
  const namespace = attribute(resource, "service.namespace").toLowerCase();
  // Names are exclusions only. A plausible service name never proves origin.
  if (
    /(?:^|[-_.])(?:everr|demo|test|synthetic|telemetrygen|verify)(?:$|[-_.])/i.test(
      row.serviceName,
    ) ||
    namespace === "everr" ||
    /^everr-labs\//i.test(attribute(resource, "vcs.repository.name")) ||
    excludedAttributes(resource) ||
    excludedAttributes(row.spanAttributes) ||
    ["everr.telemetry.provenance", "everr.data.provenance"].some((key) =>
      /test|demo|synthetic|internal|everr/i.test(attribute(resource, key)),
    )
  )
    return undefined;

  if (
    namespace === "cicd" &&
    attribute(resource, "vcs.provider.name") === "github" &&
    /^[1-9]\d*$/.test(attribute(resource, "cicd.pipeline.run.id")) &&
    /^[^/\s]+\/[^/\s]+$/.test(attribute(resource, "vcs.repository.name")) &&
    attribute(resource, "cicd.pipeline.name").trim()
  )
    return "ci";

  const currentEnvironment = rawAttribute(resource, "deployment.environment.name");
  const environment =
    currentEnvironment === undefined
      ? attribute(resource, "deployment.environment")
      : currentEnvironment;
  return environment === "production" ? "production" : undefined;
}

function observe(
  principal: ConsultationPrincipal,
  rows: readonly TraceRecord[],
  evidence: Extract<UsefulConsultation["evidence"], { kind: "detail" | "query" }>,
) {
  const matched = rows.slice(0, 1000).filter((row) => origin(row));
  const dataOrigin = matched[0] && origin(matched[0]);
  if (!dataOrigin) return;
  consultations.observe({
    organizationId: principal.organizationId,
    principal,
    completion: "succeeded",
    trigger: evidence.surface === "mcp" ? "agent-request" : "user",
    data: {
      organizationId: principal.organizationId,
      origin: dataOrigin,
      provenance: "own-customer-telemetry",
    },
    evidence: { ...evidence, matchedOwnRecords: matched.length },
  });
}

/** Ancillary synchronous evidence inspection never changes the successful read. */
function contain(completion: () => void) {
  try {
    completion();
  } catch {
    try {
      serverLogger.error("organization.consultations.failed", {
        "everr.consultation.failure_stage": "completion",
      });
    } catch {
      // A broken observer or logger cannot turn a completed consultation into an error.
    }
  }
}

/** Only called by the explicit UI route loader, never by shared poll/refetch reads. */
export function observeTraceDetail(args: {
  principal: ConsultationPrincipal;
  rows: readonly TraceRecord[];
}) {
  contain(() =>
    observe(args.principal, args.rows, {
      kind: "detail",
      surface: "ui",
      entity: "trace",
      matchedOwnRecords: 1,
    }),
  );
}

/** The caller must pass rows actually included in its successful response. */
export function observeTraceQuery(args: {
  principal: ConsultationPrincipal;
  surface: "cli" | "mcp";
  sql: string;
  rows: readonly unknown[];
  columns?: readonly string[];
}) {
  contain(() => {
    const query = traceDetailSql.exec(args.sql);
    if (!query || Number(query[2]) > 1000) return;
    const columns = args.columns;
    const rows = args.rows.slice(0, 1000).flatMap((value): TraceRecord[] => {
      const row =
        Array.isArray(value) && columns
          ? Object.fromEntries(
              ["TraceId", "ServiceName", "ResourceAttributes", "SpanAttributes"].map((key) => [
                key,
                value[columns.indexOf(key)],
              ]),
            )
          : record(value);
      return row?.TraceId === query[1] && typeof row.ServiceName === "string"
        ? [
            {
              traceId: row.TraceId,
              serviceName: row.ServiceName,
              resourceAttributes: row.ResourceAttributes,
              spanAttributes: row.SpanAttributes,
            },
          ]
        : [];
    });
    observe(args.principal, rows, {
      kind: "query",
      surface: args.surface,
      purpose: "telemetry-analysis",
      matchedOwnRecords: 1,
    });
  });
}
