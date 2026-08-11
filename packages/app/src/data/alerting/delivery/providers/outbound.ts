import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const SEND_TIMEOUT_MS = 10_000;

// A 4xx from the provider means retrying the identical request cannot
// succeed (a revoked webhook, a malformed payload), except 408 and 429,
// which mean "try again". Everything else (5xx, network failure, timeout) is
// transient and worth Graphile's retry budget.
const RETRYABLE_CLIENT_ERROR_STATUSES = new Set([408, 429]);

export class ChannelSendError extends Error {
  readonly permanent: boolean;

  constructor(message: string, opts: { permanent: boolean }) {
    super(message);
    this.name = "ChannelSendError";
    this.permanent = opts.permanent;
  }
}

function isPermanentStatus(status: number): boolean {
  return (
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_CLIENT_ERROR_STATUSES.has(status)
  );
}

function blockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value)))
    return true;
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
    normalized.startsWith("::ffff:")
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
  if (isIP(hostname) && blockedAddress(hostname)) {
    throw new Error("notification URL must not target an internal address");
  }
  if (!isIP(hostname)) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (
      addresses.length === 0 ||
      addresses.some((item) => blockedAddress(item.address))
    ) {
      throw new Error("notification URL resolved to an internal address");
    }
  }
  return url;
}

/**
 * A validated JSON POST to a channel-supplied URL, with the outcome classified
 * into permanent or transient so the send job knows whether a retry can help.
 */
export async function postJson(urlRaw: string, body: unknown): Promise<void> {
  const url = await validateOutboundUrl(urlRaw);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ChannelSendError(
      `notification webhook failed: ${response.status} ${detail}`,
      { permanent: isPermanentStatus(response.status) },
    );
  }
}
