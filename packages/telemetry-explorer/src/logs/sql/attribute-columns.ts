import { type AttributeSource, AttributeSourceSchema } from "../schemas";

const COLUMNS: Record<AttributeSource, string> = {
  resource: "ResourceAttributes",
  log: "LogAttributes",
  scope: "ScopeAttributes",
};

export const ATTRIBUTE_SOURCES = AttributeSourceSchema.options;

export function attributeColumn(source: AttributeSource): string {
  const column = COLUMNS[source];
  if (!column) throw new Error(`Unknown attribute source: ${source}`);
  return column;
}
