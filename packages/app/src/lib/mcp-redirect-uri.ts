export type RedirectDestination =
  | { kind: "this-computer"; address: string }
  | { kind: "app"; address: string };

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
}

export function isLoopbackRedirectUri(uri: string): boolean {
  const url = parse(uri);
  return url !== null && isLoopback(url);
}

export function describeRedirectUri(uri: string): RedirectDestination | null {
  const url = parse(uri);
  if (!url) return null;
  if (isLoopback(url)) return { kind: "this-computer", address: url.host };
  if (url.protocol === "https:") return { kind: "app", address: url.host };
  // Custom schemes have an opaque host and a "null" origin.
  return { kind: "app", address: url.host ? `${url.protocol}//${url.host}` : url.protocol };
}
