import { attributeExists, attributeText } from "./json-attributes";

export function resourceAttribute(key: string): string {
  return attributeText("ResourceAttributes", key);
}

export function resourceAttributeKeyExists(key: string): string {
  return attributeExists("ResourceAttributes", key);
}
