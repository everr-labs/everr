// Endpoint and key resolution, mirroring the web app's telemetry client
// (keep the endpoints in sync with packages/app/src/telemetry/config.ts).
// Three ordered cases: an explicit endpoint override wins (carrying the key
// when one is set, e.g. a dev-host collector that still authenticates), a
// public origin-bound key ships to the hosted ingest with a Bearer header,
// dev falls back to the local collector. A keyless production build
// resolves to `null` so the SDK never builds an emitter at all.
//
// A caller-supplied `send` short-circuits all of it: the host owns delivery,
// so there is no URL to resolve, no key to carry, and no keyless no-op.
//
// Internal shapes are tuples: property names survive minification (consumers
// bundle our source), tuple indexes do not.

export type Signal = "logs" | "traces";

/**
 * One OTLP/JSON payload for one signal. `keepalive` is the browser exit path
 * and is meaningless to a custom sender, which is why the public option
 * never sees it.
 */
export type Send = (
  signal: Signal,
  body: string,
  keepalive?: boolean,
) => unknown;

/**
 * The public `send` option: the same contract minus `keepalive`, which is a
 * fetch concept the host has no use for.
 */
export type HostSend = (signal: Signal, body: string) => unknown;

type TransportConfig = [send: Send, truncateAtExit: boolean];

/** Posts each batch to the resolved OTLP endpoint. */
export function fetchSend(
  logsUrl: string,
  tracesUrl: string,
  extraHeaders: Record<string, string> | undefined,
): Send {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  // The fetch reference is captured at WebSDK construction, before the network signal
  // patches the global: SDK POSTs structurally cannot be seen by the patch,
  // so no span-of-our-own-batch loop is possible and no URL exclusion is
  // needed. Tests stub the global before constructing, so they capture the stub.
  const doFetch = fetch;
  return (signal, body, keepalive) =>
    doFetch(signal === "logs" ? logsUrl : tracesUrl, {
      method: "POST",
      headers,
      body,
      keepalive,
    });
}

export function resolveTransport(options: {
  ingestKey?: string;
  endpoint?: string;
  dev?: boolean;
  send?: HostSend;
}): TransportConfig | null {
  const custom = options.send;
  if (custom) {
    // Wrapped, not passed through: this drops the third argument so a host
    // sender can never see `keepalive`. The `false` turns off exit
    // truncation, because the keepalive byte budget is a fetch constraint and
    // a host that forwards the payload itself has no such limit.
    return [(signal, body) => custom(signal, body), false];
  }

  const key = options.ingestKey?.trim();
  const endpoint = options.endpoint?.trim().replace(/\/+$/, "");
  const base =
    endpoint ||
    (key
      ? "https://ingest.everr.dev"
      : options.dev
        ? "http://127.0.0.1:54318"
        : null);
  if (!base) return null;
  return [
    fetchSend(
      `${base}/v1/logs`,
      `${base}/v1/traces`,
      key ? { Authorization: `Bearer ${key}` } : undefined,
    ),
    true,
  ];
}
