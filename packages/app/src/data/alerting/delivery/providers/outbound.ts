import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const SEND_TIMEOUT_MS = 10_000;

// A 4xx from the provider means retrying the identical request cannot
// succeed (a revoked webhook, a malformed payload), except 408 and 429,
// which mean "try again". Everything else (5xx, network failure, timeout) is
// transient and worth Graphile's retry budget.
const RETRYABLE_CLIENT_ERROR_STATUSES = new Set([408, 429]);

/**
 * A failed send. `message` is ours: a status, a timeout, or a network
 * failure. It never carries the endpoint's answer, the request URL, or a
 * header value. Any of those can be a secret, and this text is stored and
 * logged, so the send leaves them out instead of redacting them afterwards.
 */
export class ChannelSendError extends Error {
  readonly permanent: boolean;
  readonly status?: number;

  constructor(message: string, opts: { permanent: boolean; status?: number }) {
    super(message);
    this.name = "ChannelSendError";
    this.permanent = opts.permanent;
    this.status = opts.status;
  }
}

/**
 * Whether repeating the identical request could ever produce a different
 * answer. Every provider classifies with this, including the ones that build
 * their own request instead of going through `postJson`, so a dead endpoint
 * costs one attempt rather than the whole retry budget.
 */
function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && !RETRYABLE_CLIENT_ERROR_STATUSES.has(status);
}

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value))) return true;
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function blockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:") ||
    // NAT64 (RFC 6052) and 6to4: both embed a v4 address, so a network with
    // either gateway reaches 127.0.0.1 through an address the prefixes above
    // do not match.
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("2002:")
  );
}

function blockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family === 6) return blockedIpv6(address);
  return true;
}

/**
 * The guard every user-supplied destination passes before we call it. A
 * channel URL is attacker-influenced input that the server fetches, so an
 * unguarded send is an SSRF into whatever the application plane can reach.
 *
 * Providers whose endpoint is fixed by us (Telegram's api.telegram.org) do not
 * need it; every provider that posts to a URL out of the channel config does.
 */
export async function validateOutboundUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("notification URL must be a valid absolute URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("notification URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("notification URL must not contain userinfo");
  }
  const hostname = url.hostname.replace(/\.$/, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("notification URL must not target localhost");
  }
  // The WHATWG parser keeps the brackets on an IPv6 literal, and isIP rejects
  // the bracketed form. Left unstripped, every v6 literal skips the blocklist
  // and falls through to a DNS lookup for "[::1]". That fails with a name
  // error instead of saying the address is internal.
  const literal =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (isIP(literal) && blockedAddress(literal)) {
    throw new Error("notification URL must not target an internal address");
  }
  if (!isIP(literal)) {
    // A resolver error names the host. The URL can be the secret, so the
    // message that gets stored stays generic.
    let addresses: { address: string }[];
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new Error("notification URL could not be resolved");
    }
    if (addresses.length === 0 || addresses.some((item) => blockedAddress(item.address))) {
      throw new Error("notification URL resolved to an internal address");
    }
  }
  return url;
}

function outboundFailureReason(cause: unknown): "timeout" | "network" {
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return "timeout";
  }
  return "network";
}

/**
 * POST that reports only our outcome. The endpoint's body is cancelled
 * unread, and a transport error is replaced: both can repeat the request
 * URL or a header, and neither is safe to store.
 */
export async function postOutbound(
  url: URL | string,
  init: { body: string; headers?: HeadersInit; redirect?: RequestRedirect },
  label: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: init.headers,
      body: init.body,
      redirect: init.redirect,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (cause) {
    // The runtime error quotes the URL. Leave it off this error: the message
    // is what the trail and the job log keep.
    throw new ChannelSendError(`${label} failed: ${outboundFailureReason(cause)}`, {
      permanent: false,
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new ChannelSendError(`${label} failed: ${response.status}`, {
      permanent: isPermanentStatus(response.status),
      status: response.status,
    });
  }
}

/**
 * A validated JSON POST to a channel-supplied URL, with the outcome classified
 * into permanent or transient so the send job knows whether a retry can help.
 */
export async function postJson(
  urlRaw: string,
  body: unknown,
  extraHeaders?: HeadersInit,
): Promise<void> {
  const url = await validateOutboundUrl(urlRaw);
  // Set last, so a caller-supplied content-type cannot relabel the JSON body.
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json");
  await postOutbound(
    url,
    { body: JSON.stringify(body), headers, redirect: "error" },
    "notification webhook",
  );
}
