import type { AttributeOp, AttributeSource } from "../schemas";

export const ATTRIBUTE_OP_LABELS: Record<AttributeOp, string> = {
  in: "Is",
  not_in: "Is not",
  contains: "Contains",
  not_contains: "Does not contain",
  matches: "Matches regex",
  gt: "Greater than",
  gte: "At least",
  lt: "Less than",
  lte: "At most",
  exists: "Exists",
  missing: "Missing",
};

// Lowercase connectors used when rendering a filter inline as a pill
// (e.g. "Environment is production").
export const ATTRIBUTE_OP_CONNECTORS: Record<AttributeOp, string> = {
  in: "is",
  not_in: "is not",
  contains: "contains",
  not_contains: "does not contain",
  matches: "matches",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  exists: "exists",
  missing: "missing",
};

// The operators as the editor lays them out: one row each for values and
// presence, text, and numbers.
export const ATTRIBUTE_OP_ROWS: AttributeOp[][] = [
  ["in", "not_in", "exists", "missing"],
  ["contains", "not_contains", "matches"],
  ["gt", "gte", "lt", "lte"],
];

// What an operator's button shows; the full label is its accessible name.
export const ATTRIBUTE_OP_SHORT_LABELS: Record<AttributeOp, string> = {
  in: "Is",
  not_in: "Is not",
  contains: "Contains",
  not_contains: "Not contains",
  matches: "Regex",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  exists: "Exists",
  missing: "Missing",
};

// Whether an op takes a list of values, picked from the discovered ones.
export function opTakesValues(op: AttributeOp): boolean {
  return op === "in" || op === "not_in";
}

// Whether an op takes one typed value: a substring, a pattern or a number.
export function opTakesOneValue(op: AttributeOp): boolean {
  return opTakesText(op) || opIsNumeric(op);
}

export function opTakesText(op: AttributeOp): boolean {
  return op === "contains" || op === "not_contains" || op === "matches";
}

export function opIsNumeric(op: AttributeOp): boolean {
  return op === "gt" || op === "gte" || op === "lt" || op === "lte";
}

export const ATTRIBUTE_SOURCE_LABELS: Record<AttributeSource, string> = {
  resource: "Resource",
  log: "Log",
  scope: "Scope",
  span: "Span",
  metric: "Metric",
};

// Friendly display names for well-known OTel attribute keys, keyed by raw key.
// Unknown keys fall back to the raw key in the UI.
const KNOWN_ATTRIBUTE_LABELS: Record<string, string> = {
  "service.name": "Service",
  "service.namespace": "Namespace",
  "service.version": "Version",
  "service.instance.id": "Instance",
  "deployment.environment": "Environment",
  "deployment.environment.name": "Environment",
  "host.name": "Host",
  "host.arch": "Host arch",
  "os.type": "OS",
  "process.runtime.name": "Runtime",
  "telemetry.sdk.name": "SDK",
  "telemetry.sdk.language": "SDK language",
  "vcs.repository.name": "Repository",
  "vcs.ref.head.name": "Branch",
  "k8s.pod.name": "Pod",
  "k8s.namespace.name": "K8s namespace",
  "k8s.node.name": "Node",
  "container.name": "Container",
  "http.route": "Route",
  "http.request.method": "HTTP method",
  "db.system": "DB system",
  "rpc.method": "RPC method",
};

export function attributeLabel(key: string): string | undefined {
  return KNOWN_ATTRIBUTE_LABELS[key];
}

// A promoted ("Suggested") attribute, supplied per domain.
export interface PromotedAttribute {
  source: AttributeSource;
  key: string;
}
