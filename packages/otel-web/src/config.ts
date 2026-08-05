// Endpoint and key resolution, mirroring the web app's telemetry client
// (keep the endpoints in sync with packages/app/src/telemetry/config.ts).
// Three ordered cases: an explicit endpoint override wins (carrying the key
// when one is set, e.g. a dev-host collector that still authenticates), a
// public origin-bound key ships to the hosted ingest with a Bearer header,
// dev falls back to the local collector. A keyless production build
// resolves to `null` so the SDK never builds an emitter at all.
//
// Internal shapes are tuples: property names survive minification (consumers
// bundle our source), tuple indexes do not.

type TransportConfig = [
  logsUrl: string,
  tracesUrl: string,
  headers: Record<string, string> | undefined,
];

export function resolveTransport(options: {
  ingestKey?: string;
  endpoint?: string;
  dev?: boolean;
}): TransportConfig | null {
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
    `${base}/v1/logs`,
    `${base}/v1/traces`,
    key ? { Authorization: `Bearer ${key}` } : undefined,
  ];
}
