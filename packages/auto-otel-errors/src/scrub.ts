import type { Attributes } from "@opentelemetry/api";

const REPLACEMENT = "[Filtered]";

export const DEFAULT_SCRUB_PATTERNS: RegExp[] = [
  /\bBearer\s+[\w.+/=-]+/gi,
  /(?<=[?&](?:key|api_key|apikey|token|access_token|password|secret|sig|signature)=)[^&#\s]+/gi,
  /\b\d(?:[ -]?\d){12,15}\b/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

export function scrubString(value: string, patterns: RegExp[]): string {
  let out = value;
  for (const pattern of patterns) {
    out = out.replace(pattern, REPLACEMENT);
  }
  return out;
}

export function scrubAttributes(
  attributes: Attributes,
  patterns: RegExp[],
): Attributes {
  const out: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    out[key] = typeof value === "string" ? scrubString(value, patterns) : value;
  }
  return out;
}
