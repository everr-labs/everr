// Endpoint and key resolution, mirroring the web app's telemetry client
// (keep the endpoints in sync with packages/app/src/telemetry/config.ts).
// Three ordered cases: an explicit endpoint override wins (carrying the key
// when one is set, e.g. a dev-host collector that still authenticates), a
// public origin-bound key ships to the hosted ingest with a Bearer header,
// dev falls back to the local collector. A keyless production build
// resolves to `null` so the SDK never builds an emitter at all.

export type TransportConfig = {
  logsUrl: string;
  headers?: Record<string, string>;
};

export function resolveTransport(options: {
  ingestKey?: string;
  endpoint?: string;
  dev?: boolean;
}): TransportConfig | null {
  const key = options.ingestKey?.trim();
  const endpoint = options.endpoint?.trim().replace(/\/+$/, "");
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;

  if (endpoint) return { logsUrl: `${endpoint}/v1/logs`, headers };
  if (key) {
    return {
      logsUrl: "https://ingest.everr.dev/v1/logs",
      headers,
    };
  }
  if (options.dev) return { logsUrl: "http://127.0.0.1:54318/v1/logs" };
  return null;
}
