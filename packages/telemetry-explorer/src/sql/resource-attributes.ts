export function resourceAttribute(key: string): string {
  return `ResourceAttributes['${key}']`;
}

export function resourceAttributeKeyExists(key: string): string {
  return `mapContains(ResourceAttributes, '${key}')`;
}
