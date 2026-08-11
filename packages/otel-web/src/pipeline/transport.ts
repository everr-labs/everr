// This module finds the endpoint and the key. It is the same as the telemetry
// client of the web app. Keep the endpoints the same as the endpoints in
// packages/app/src/telemetry/config.ts.
//
// There are three conditions, in this sequence. First, an endpoint from the
// caller replaces the other values, and it carries the key when the app sets
// one. For example, a collector on a development host can need
// authentication. Second, a public key for one origin sends the data to the
// hosted ingest with a Bearer header. Third, a development build uses the local
// collector, which the NODE_ENV of the build selects. A production build
// without a key gives `null`, and thus the SDK makes no emitter, and the
// address of that collector is not in the bundle.
//
// A `send` function from the caller replaces all of this. The host then sends
// the data. Thus there is no URL to find, no key to carry, and no condition
// without a key.
//
// The internal structures are tuples. Minification keeps the property names,
// because a consumer builds our source. But minification does not keep the
// tuple indexes.

export type Signal = "logs" | "traces";

/**
 * One OTLP/JSON payload for one signal. The `keepalive` value is for the exit
 * path of the browser, and it has no function in a custom sender. Thus the
 * public option does not contain it.
 */
export type Send = (
  signal: Signal,
  body: string,
  keepalive?: boolean,
) => unknown;

/**
 * The public `send` option. It is the same, but it has no `keepalive` value.
 * That value belongs to fetch, and the host does not need it.
 */
export type HostSend = (signal: Signal, body: string) => unknown;

type TransportConfig = [send: Send, truncateAtExit: boolean];

/** Sends each batch with POST to the OTLP endpoint that the code found. */
export function fetchSend(
  logsUrl: string,
  tracesUrl: string,
  extraHeaders: Record<string, string> | undefined,
): Send {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  // The code keeps this reference to fetch when it constructs the WebSDK. This
  // occurs before the network signal changes the global fetch. Thus the changed
  // fetch cannot see the POST operations of the SDK. Thus the SDK cannot make a
  // span for its own batch, and the code needs no list of URLs to ignore. A
  // test replaces the global fetch before it constructs the SDK, and thus the
  // SDK keeps the replacement.
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
  send?: HostSend;
}): TransportConfig | null {
  const custom = options.send;
  if (custom) {
    // This function contains the sender of the host, and the code does not use
    // that sender directly. Thus the code removes the third argument, and the
    // sender of the host never sees `keepalive`. The value `false` stops the
    // decrease of the payload at exit. The keepalive limit in bytes is a
    // constraint of fetch only, and a host that sends the payload itself has no
    // such limit.
    return [(signal, body) => custom(signal, body), false];
  }

  const key = options.ingestKey?.trim();
  const endpoint = options.endpoint?.trim().replace(/\/+$/, "");
  const base =
    endpoint ||
    (key
      ? "https://ingest.everr.dev"
      : process.env.NODE_ENV !== "production"
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
