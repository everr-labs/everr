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

export interface PromotedAttribute {
  source: AttributeSource;
  key: string;
  label: string;
}

export const PROMOTED_ATTRIBUTES: PromotedAttribute[] = [
  { source: "resource", key: "vcs.repository.name", label: "Repository" },
  { source: "resource", key: "deployment.environment", label: "Environment" },
  { source: "resource", key: "host.name", label: "Host" },
];
