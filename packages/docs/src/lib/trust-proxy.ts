import { isIP } from "node:net";

type TrustProxy = boolean | "loopback" | string[];

/**
 * srvx's `trustProxy` from the TRUST_PROXY environment variable. It decides whether
 * `X-Forwarded-Proto`, `-Host` and `-For` shape `request.url` and `request.ip`:
 *
 * - unset or `false`: never (srvx's default; right when nothing sits in front, or the
 *   proxy might pass client-sent forwarded headers through)
 * - `true`: always; only behind a proxy that is the sole way in and overwrites those
 *   headers (everr-deploy: Traefik, ClusterIP services)
 * - `loopback`: when the proxy connects from 127.0.0.0/8 or ::1
 * - a comma-separated list of the proxy's IP addresses
 *
 * Anything else stops the server at startup rather than silently trusting nothing.
 */
export function parseTrustProxy(value: string | undefined): TrustProxy {
  const setting = value?.trim() ?? "";
  if (setting === "" || setting === "false") return false;
  if (setting === "true") return true;
  if (setting === "loopback") return "loopback";

  const addresses = setting.split(",").map((address) => address.trim());
  const invalid = addresses.filter((address) => isIP(address) === 0);
  if (invalid.length > 0) {
    throw new Error(
      `TRUST_PROXY must be true, false, loopback or a comma-separated list of IP addresses; got ${invalid.join(", ")}`,
    );
  }
  return addresses;
}
