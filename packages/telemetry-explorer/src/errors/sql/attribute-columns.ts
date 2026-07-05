import type { AttributeSource } from "../../attribute-filter/schemas";

const COLUMNS: Record<string, string> = {
  resource: "ResourceAttributes",
  log: "LogAttributes",
  scope: "ScopeAttributes",
};

export const ERRORS_ATTRIBUTE_SOURCES: AttributeSource[] = ["resource", "log", "scope"];

export function errorsAttributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown errors attribute source: ${source}`);
  return column;
}
