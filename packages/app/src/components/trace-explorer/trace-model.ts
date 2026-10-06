import type { Span } from "@everr/telemetry-explorer/traces";
import { parseTimestampAsUTC } from "@everr/ui/lib/timestamp";
import { computeVisualLayout } from "./rendering/compute-visual-layout";
import type { FlamegraphSpan, WaterfallSpan } from "./rendering/types";

export type TraceNode = FlamegraphSpan & WaterfallSpan & { source: Span };
export type SpanCategory = "All" | "HTTP" | "Database" | "Functions" | "Jobs";
export const SPAN_CATEGORIES: SpanCategory[] = [
  "All",
  "HTTP",
  "Database",
  "Functions",
  "Jobs",
];

function eventTimeNs(timestamp: string): bigint | undefined {
  const date = parseTimestampAsUTC(timestamp);
  if (!date || Number.isNaN(date.getTime())) return undefined;
  const fraction = timestamp.match(/\d{2}:\d{2}:\d{2}\.(\d+)/)?.[1] ?? "";
  const subMs = fraction.padEnd(9, "0").slice(3, 9);
  return BigInt(date.getTime()) * 1_000_000n + BigInt(subMs || "0");
}

export function buildTraceModel(spans: Span[]) {
  const ordered = [...new Map(spans.map((s) => [s.spanId, s])).values()].sort(
    (a, b) => {
      const startA = BigInt(a.timestampNs);
      const startB = BigInt(b.timestampNs);
      return startA < startB
        ? -1
        : startA > startB
          ? 1
          : a.spanId.localeCompare(b.spanId);
    },
  );
  const startNs = ordered.length ? BigInt(ordered[0].timestampNs) : 0n;
  let endNs = startNs;
  const byId = new Map<string, TraceNode>();
  let missingParents = 0;
  for (const source of ordered) {
    const timestampNs = BigInt(source.timestampNs);
    const durationNs = BigInt(source.duration);
    if (timestampNs + durationNs > endNs) endNs = timestampNs + durationNs;
    byId.set(source.spanId, {
      spanId: source.spanId,
      span_id: source.spanId,
      parentSpanId: source.parentSpanId,
      parent_span_id: source.parentSpanId,
      name: source.spanName,
      timestamp: Number(timestampNs - startNs) / 1e6,
      durationNano: Number(durationNs),
      hasError: source.statusCode === "Error",
      resource: {
        ...source.resourceAttributes,
        "service.name": source.serviceName,
      },
      attributes: source.spanAttributes,
      event: source.events.flatMap((event) => {
        const time = eventTimeNs(event.timestamp);
        return time === undefined
          ? []
          : [
              {
                name: event.name,
                timeUnixNano: Number(time - startNs),
                attributeMap: event.attributes,
                isError:
                  event.name === "exception" ||
                  event.attributes["exception.type"] !== undefined,
              },
            ];
      }),
      level: 0,
      has_children: false,
      source,
    });
  }

  // Break malformed parent cycles and treat missing parents as additional roots.
  // Walk parent chains iteratively so deep traces do not overflow here.
  const settled = new Set<string>();
  for (const node of byId.values()) {
    const path = new Set<string>();
    let current: TraceNode | undefined = node;
    while (current && !settled.has(current.spanId)) {
      path.add(current.spanId);
      const parent = byId.get(current.parentSpanId);
      if (current.parentSpanId && (!parent || path.has(parent.spanId))) {
        if (!parent) missingParents++;
        current.parentSpanId = "";
        current.parent_span_id = "";
        break;
      }
      current = parent;
    }
    for (const id of path) settled.add(id);
  }

  const children = new Map<string, TraceNode[]>();
  for (const node of byId.values()) {
    const siblings = children.get(node.parentSpanId) ?? [];
    siblings.push(node);
    children.set(node.parentSpanId, siblings);
  }
  const roots = children.get("") ?? [];
  const waterfall: TraceNode[] = [];
  const stack = [...roots].reverse().map((node) => ({ node, level: 0 }));
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) break;
    const descendants = children.get(entry.node.spanId) ?? [];
    entry.node.level = entry.level;
    entry.node.has_children = descendants.length > 0;
    waterfall.push(entry.node);
    for (let i = descendants.length - 1; i >= 0; i--) {
      stack.push({ node: descendants[i], level: entry.level + 1 });
    }
  }

  return {
    byId,
    roots,
    waterfall,
    layout: computeVisualLayout([waterfall]),
    startNs,
    durationMs: Math.max(Number(endNs - startNs) / 1e6, 0.001),
    missingParents,
    errorCount: waterfall.filter((node) => node.hasError).length,
  };
}

export type TraceModel = ReturnType<typeof buildTraceModel>;

export function matchesSpan(
  node: TraceNode,
  query: string,
  category: SpanCategory,
  errorsOnly: boolean,
) {
  if (errorsOnly && !node.hasError) return false;
  const attrs = node.attributes;
  if (
    category === "HTTP" &&
    !Object.keys(attrs).some((key) => key.startsWith("http."))
  )
    return false;
  if (
    category === "Database" &&
    !Object.keys(attrs).some((key) => key.startsWith("db."))
  )
    return false;
  if (
    category === "Jobs" &&
    !Object.keys(attrs).some((key) => key.startsWith("messaging."))
  )
    return false;
  if (
    category === "Functions" &&
    !node.source.spanKind.toLowerCase().includes("internal")
  )
    return false;
  if (!query.trim()) return true;
  const haystack = [
    node.name,
    node.source.serviceName,
    node.spanId,
    ...Object.entries(node.resource).map(([k, v]) => `${k}=${v}`),
    ...Object.entries(attrs).map(([k, v]) => `${k}=${v}`),
  ]
    .join("\n")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

export function spanColorGroup(node: FlamegraphSpan, field: string): string {
  return node.attributes[field] ?? node.resource[field] ?? "unknown";
}
