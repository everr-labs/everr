/**
 * Accept-header negotiation shared by the Markdown middleware and the
 * agent-friendly error responses.
 *
 * Rules, in order:
 *  - an explicit `text/markdown` that is at least as preferred as HTML wins;
 *  - an explicit `application/json` that beats HTML and Markdown wins;
 *  - anything that accepts HTML (`text/html`, `text/*`) keeps the HTML page;
 *  - a missing header or a wildcard-only Accept falls back to Markdown, because
 *    that is what non-browser clients (curl, agents, fetch without an Accept
 *    header) send;
 *  - everything else is unacceptable (406).
 *
 * A wildcard never counts as "accepts HTML": browsers always name `text/html`
 * explicitly, so this keeps the rendered site intact for them while letting
 * plain clients get Markdown.
 */
export type NegotiatedMediaType = "markdown" | "json" | "html" | "unacceptable";

type AcceptEntry = {
  type: string;
  subtype: string;
  quality: number;
};

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
export const JSON_CONTENT_TYPE = "application/json; charset=utf-8";
export const VARY_ACCEPT = "Accept, Accept-Encoding";

export function negotiateMediaType(accept: string | null): NegotiatedMediaType {
  if (accept === null || accept.trim().length === 0) return "markdown";

  const entries = parseAccept(accept);
  const markdownQuality = Math.max(
    qualityFor(entries, "text", "markdown"),
    qualityFor(entries, "text", "plain"),
  );
  const jsonQuality = qualityFor(entries, "application", "json");
  const htmlQuality = qualityFor(entries, "text", "html");
  const wildcardQuality = explicitWildcardQuality(entries);

  if (markdownQuality > 0 && markdownQuality >= htmlQuality) return "markdown";
  if (
    jsonQuality > 0 &&
    jsonQuality >= htmlQuality &&
    jsonQuality >= markdownQuality
  ) {
    return "json";
  }
  if (htmlQuality > 0) return "html";
  if (wildcardQuality > 0) return "markdown";

  return "unacceptable";
}

/**
 * True when the client explicitly named `text/markdown`, as opposed to
 * falling into Markdown through a wildcard. Pages only switch away from HTML
 * on an explicit ask, so link previewers and crawlers sending a wildcard Accept
 * keep the rendered page.
 */
export function wantsMarkdownExplicitly(accept: string | null): boolean {
  if (!accept) return false;

  const entries = parseAccept(accept);
  const markdownQuality = explicitQualityFor(entries, "text", "markdown");
  if (markdownQuality <= 0) return false;

  return markdownQuality >= qualityFor(entries, "text", "html");
}

function parseAccept(accept: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];

  for (const part of accept.split(",")) {
    const [rawMediaType, ...parameters] = part.split(";");
    const mediaType = rawMediaType?.trim().toLowerCase();
    if (!mediaType) continue;

    const [type, subtype] = mediaType.split("/");
    if (!type || !subtype) continue;

    entries.push({ type, subtype, quality: parseQuality(parameters) });
  }

  return entries;
}

function parseQuality(parameters: string[]): number {
  for (const parameter of parameters) {
    const [name, value] = parameter.split("=");
    if (name?.trim().toLowerCase() !== "q") continue;

    const quality = Number.parseFloat(value ?? "");
    if (Number.isNaN(quality)) return 1;
    return Math.min(Math.max(quality, 0), 1);
  }

  return 1;
}

/** Best quality any entry gives to `type/subtype`, wildcards included. */
function qualityFor(
  entries: AcceptEntry[],
  type: string,
  subtype: string,
): number {
  let best = 0;

  for (const entry of entries) {
    const typeMatches = entry.type === type || entry.type === "*";
    const subtypeMatches = entry.subtype === subtype || entry.subtype === "*";
    if (typeMatches && subtypeMatches) best = Math.max(best, entry.quality);
  }

  return best;
}

/** Best quality an entry names for `type/subtype` without using a wildcard. */
function explicitQualityFor(
  entries: AcceptEntry[],
  type: string,
  subtype: string,
): number {
  let best = 0;

  for (const entry of entries) {
    if (entry.type === type && entry.subtype === subtype) {
      best = Math.max(best, entry.quality);
    }
  }

  return best;
}

function explicitWildcardQuality(entries: AcceptEntry[]): number {
  let best = 0;

  for (const entry of entries) {
    if (entry.type === "*" && entry.subtype === "*") {
      best = Math.max(best, entry.quality);
    }
  }

  return best;
}
