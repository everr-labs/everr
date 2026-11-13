export const HTML = "text/html";
export const MARKDOWN = "text/markdown";

type Offer = typeof HTML | typeof MARKDOWN;

type AcceptEntry = { range: string; q: number };

// Specificity of the Accept entry that matched an offer: exact type, type/*, */*
type Match = { q: number; specificity: 0 | 1 | 2 };

function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(",")
    .map((part) => {
      const [range = "", ...params] = part.split(";").map((s) => s.trim());
      let q = 1;
      for (const param of params) {
        const [key, value] = param.split("=").map((s) => s.trim());
        if (key?.toLowerCase() === "q") {
          const parsed = Number.parseFloat(value ?? "");
          q = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 1) : 0;
        }
      }
      return { range: range.toLowerCase(), q };
    })
    .filter((entry) => entry.range.length > 0);
}

function specificity(range: string): 0 | 1 | 2 {
  if (range === "*/*") return 0;
  if (range.endsWith("/*")) return 1;
  return 2;
}

function matches(range: string, offer: Offer) {
  if (range === "*/*") return true;
  if (range.endsWith("/*")) return offer.startsWith(range.slice(0, -1));
  return range === offer;
}

// The most specific entry decides the q-value of an offer (RFC 9110 section 12.5.1)
function bestMatch(entries: AcceptEntry[], offer: Offer): Match {
  let match: AcceptEntry | undefined;
  for (const entry of entries) {
    if (!matches(entry.range, offer)) continue;
    if (!match || specificity(entry.range) > specificity(match.range)) match = entry;
  }
  return match ? { q: match.q, specificity: specificity(match.range) } : { q: 0, specificity: 0 };
}

function compare(a: Match, b: Match) {
  return a.q - b.q || a.specificity - b.specificity;
}

export function accepts(accept: string | null, offer: Offer) {
  if (accept === null || accept.trim() === "") return true;
  return bestMatch(parseAccept(accept), offer).q > 0;
}

/**
 * Picks the representation of a page. A missing Accept header, a bare wildcard and
 * `text/*` get HTML, the default. Markdown wins when the client names it with a
 * q-value at least as high as HTML's. Returns null when the client accepts neither,
 * which is a 406.
 */
export function negotiatePage(accept: string | null): Offer | null {
  if (accept === null || accept.trim() === "") return HTML;

  const entries = parseAccept(accept);
  const html = bestMatch(entries, HTML);
  const markdown = bestMatch(entries, MARKDOWN);

  if (markdown.q > 0) {
    const order = compare(markdown, html);
    if (order > 0 || (order === 0 && markdown.specificity === 2)) return MARKDOWN;
  }
  return html.q > 0 ? HTML : null;
}

/**
 * Picks the representation of a 404. Browsers always name text/html, so only they get
 * the HTML page. Clients that send no Accept header or a bare wildcard (curl, fetch
 * libraries, most agents) get a short Markdown body they can recover from.
 */
export function negotiateNotFound(accept: string | null): Offer {
  if (accept === null || accept.trim() === "") return MARKDOWN;

  const entries = parseAccept(accept);
  const html = bestMatch(entries, HTML);
  const markdown = bestMatch(entries, MARKDOWN);

  if (html.q > 0 && compare(html, markdown) > 0) return HTML;
  return MARKDOWN;
}
