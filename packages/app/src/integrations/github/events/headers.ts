import type { WebhookHeaders } from "./types";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export function headersToRecord(headers: Headers): WebhookHeaders {
  const record: WebhookHeaders = {};

  for (const [key, value] of headers.entries()) {
    const normalizedKey = key.toLowerCase();
    const current = record[normalizedKey] ?? [];
    current.push(value);
    record[normalizedKey] = current;
  }

  return record;
}

export function recordToHeaders(record: WebhookHeaders): Headers {
  const headers = new Headers();

  for (const [key, values] of Object.entries(record)) {
    for (const value of values) {
      headers.append(key, value);
    }
  }

  return headers;
}

export function firstHeader(
  headers: Headers | WebhookHeaders,
  name: string,
): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }

  const values = headers[name.toLowerCase()];
  return values?.[0] ?? null;
}

export function stripHopByHopHeaders(headers: Headers) {
  for (const header of hopByHopHeaders) {
    headers.delete(header);
  }
}
