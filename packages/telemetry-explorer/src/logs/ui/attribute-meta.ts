import type { AttributeOp, AttributeSource } from "../schemas";

export const ATTRIBUTE_OP_LABELS: Record<AttributeOp, string> = {
  in: "Is",
  not_in: "Is not",
  exists: "Exists",
  missing: "Missing",
};

// Lowercase connectors used when rendering a filter inline as a pill
// (e.g. "Environment is production").
export const ATTRIBUTE_OP_CONNECTORS: Record<AttributeOp, string> = {
  in: "is",
  not_in: "is not",
  exists: "exists",
  missing: "missing",
};

// Whether an op takes a list of values (vs. presence-only checks).
export function opTakesValues(op: AttributeOp): boolean {
  return op === "in" || op === "not_in";
}

export const ATTRIBUTE_SOURCE_LABELS: Record<AttributeSource, string> = {
  resource: "Resource",
  log: "Log",
  scope: "Scope",
};

// Friendly display names for well-known attribute keys, keyed by the raw key.
// Easy to extend; unknown keys fall back to the raw key in the UI.
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
};

export function attributeLabel(key: string): string | undefined {
  return KNOWN_ATTRIBUTE_LABELS[key];
}

// Quick-pick keys surfaced under "Suggested" in the picker. Their display
// names come from attributeLabel(), same as every other key — keep these keys
// in KNOWN_ATTRIBUTE_LABELS so they render with a friendly name.
export const PROMOTED_ATTRIBUTES: { source: AttributeSource; key: string }[] = [
  { source: "resource", key: "vcs.repository.name" },
  { source: "resource", key: "deployment.environment" },
  { source: "resource", key: "host.name" },
];
