import type { AttributeKey, AttributeKeysInput, AttributeValuesInput } from "./schemas";

// The slice of a domain repository the attribute-filter UI needs. Each domain's
// repository (logs, errors, traces) implements these two methods.
export type AttributeRepositoryLike = {
  attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]>;
  attributeValues(input: AttributeValuesInput): Promise<string[]>;
};
