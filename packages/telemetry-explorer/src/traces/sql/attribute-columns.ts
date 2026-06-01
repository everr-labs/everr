import type { AttributeSource } from "../../attribute-filter/schemas";

const COLUMNS: Record<string, string> = {
  resource: "ResourceAttributes",
  span: "SpanAttributes",
};

export const TRACES_ATTRIBUTE_SOURCES: AttributeSource[] = ["resource", "span"];

export function tracesAttributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown traces attribute source: ${source}`);
  return column;
}
