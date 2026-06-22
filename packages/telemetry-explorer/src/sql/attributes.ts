import type { AttributeSource } from "../attribute-filter/schemas";

// A source maps to the same ClickHouse column regardless of signal — this
// mapping is global. Only *which* sources a signal exposes varies, and that
// lives in each signal's schema below.
const COLUMN_BY_SOURCE: Record<AttributeSource, string> = {
  resource: "ResourceAttributes",
  log: "LogAttributes",
  scope: "ScopeAttributes",
  span: "SpanAttributes",
};

export function attributeColumn(source: AttributeSource): string {
  return COLUMN_BY_SOURCE[source];
}

// A signal's attribute schema: which sources it exposes, and how each maps to a
// column. `columnFor` rejects sources the signal doesn't expose so callers fail
// loudly rather than querying a column that can't hold the attribute.
interface SignalAttributeSchema {
  readonly sources: AttributeSource[];
  readonly columnFor: (source: AttributeSource) => string;
}

function signalAttributeSchema(
  signal: string,
  sources: AttributeSource[],
): SignalAttributeSchema {
  const allowed = new Set(sources);
  return {
    sources,
    columnFor(source) {
      if (!allowed.has(source)) {
        throw new Error(`Unknown ${signal} attribute source: ${source}`);
      }
      return attributeColumn(source);
    },
  };
}

export const LOGS_ATTRIBUTE_SCHEMA = signalAttributeSchema("logs", [
  "resource",
  "log",
  "scope",
]);

export const TRACES_ATTRIBUTE_SCHEMA = signalAttributeSchema("traces", [
  "resource",
  "span",
]);

export const ERRORS_ATTRIBUTE_SCHEMA = signalAttributeSchema("errors", [
  "resource",
  "log",
  "scope",
]);
