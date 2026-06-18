import type { Attributes } from "@opentelemetry/api";

const FILTERED = "[Filtered]";
const SENSITIVE_QUERY_PARAM_PATTERN =
  /([?&](?:key|api_key|apikey|token|access_token|password|secret|sig|signature)=)[^&#\s]+/gi;

export const SENSITIVE_KEY_SNIPPETS = [
  "auth",
  "token",
  "secret",
  "session",
  "password",
  "passwd",
  "pwd",
  "key",
  "jwt",
  "bearer",
  "sso",
  "saml",
  "csrf",
  "xsrf",
  "credentials",
  "sid",
  "identity",
];

export type CollectBehavior = boolean | { allow: string[] } | { deny: string[] };

function isSensitiveKey(lower: string): boolean {
  return SENSITIVE_KEY_SNIPPETS.some((snippet) => lower.includes(snippet));
}

export function filterKeyValueData(
  data: Attributes,
  behavior: CollectBehavior,
): Attributes {
  if (behavior === false) {
    return {};
  }

  const denyTerms =
    behavior !== true && "deny" in behavior
      ? behavior.deny.map((t) => t.toLowerCase())
      : null;
  const allowTerms =
    behavior !== true && "allow" in behavior
      ? behavior.allow.map((t) => t.toLowerCase())
      : null;

  const shouldFilter = (lower: string): boolean => {
    if (isSensitiveKey(lower)) return true;
    if (denyTerms) return denyTerms.some((term) => lower.includes(term));
    if (allowTerms) return !allowTerms.some((term) => lower.includes(term));
    return false; // behavior === true: only sensitive keys are filtered
  };

  const result: Attributes = {};
  for (const key of Object.keys(data)) {
    result[key] = shouldFilter(key.toLowerCase()) ? FILTERED : data[key]!;
  }
  return result;
}

export const DEFAULT_SCRUB_PATTERNS: RegExp[] = [
  /\bBearer\s+[\w.+/=-]+/gi,
  SENSITIVE_QUERY_PARAM_PATTERN,
  /\b\d(?:[ -]?\d){12,15}\b/g,
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,
];

export function scrubString(value: string, patterns: RegExp[]): string {
  let out = value;
  for (const pattern of patterns) {
    out =
      pattern === SENSITIVE_QUERY_PARAM_PATTERN
        ? out.replace(pattern, `$1${FILTERED}`)
        : out.replace(pattern, FILTERED);
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

    const sanitized = isUrlKey(key) ? stripUrlQueryAndFragment(value) : value;
    out[key] = scrubString(sanitized, patterns);
  }
  return out;
}

function isUrlKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower === "url.full" || lower === "url" || lower.endsWith(".url");
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
