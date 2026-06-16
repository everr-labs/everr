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
    if (typeof value !== "string") {
      out[key] = value;
      continue;
    }

    const sanitized = key === "url.full" ? stripUrlQueryAndFragment(value) : value;
    out[key] = scrubString(sanitized, patterns);
  }
  return out;
}

export function stripUrlQueryAndFragment(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? "";
  }
}
