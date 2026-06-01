import type { AttributeOp, AttributeSource } from "../schemas";

export const ATTRIBUTE_OP_LABELS: Record<AttributeOp, string> = {
  in: "Is",
  not_in: "Is not",
  exists: "Exists",
  missing: "Missing",
};

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

export interface PromotedAttribute {
  source: AttributeSource;
  key: string;
  label: string;
}

// Labels are derived from KNOWN_ATTRIBUTE_LABELS so the chips, picker, and rows
// stay in sync.
export const PROMOTED_ATTRIBUTES: PromotedAttribute[] = (
  [
    { source: "resource", key: "vcs.repository.name" },
    { source: "resource", key: "deployment.environment" },
    { source: "resource", key: "host.name" },
  ] as const
).map((p) => ({ ...p, label: KNOWN_ATTRIBUTE_LABELS[p.key] ?? p.key }));
