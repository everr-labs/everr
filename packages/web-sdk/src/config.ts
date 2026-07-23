// Endpoint and key resolution, mirroring the web app's telemetry client:
// a public origin-bound key ships to the hosted ingest with a Bearer header,
// an explicit endpoint override wins (and is trusted to need no header), dev
// falls back to the local collector, and a keyless production build resolves
// to `null` so the SDK never constructs an exporter at all.

// Keep these two in sync with packages/app/src/telemetry/config.ts.
const EVERR_HOSTED_OTLP_ENDPOINT = "https://ingest.everr.dev";
const DEFAULT_LOCAL_OTLP_ENDPOINT = "http://127.0.0.1:54318";

export type TransportConfig = {
  logsUrl: string;
  headers: Record<string, string> | undefined;
};

export function resolveTransport(options: {
  ingestKey?: string;
  endpoint?: string;
  dev?: boolean;
}): TransportConfig | null {
  const ingestKey = clean(options.ingestKey);
  const explicitEndpoint = clean(options.endpoint);

  if (!ingestKey && !explicitEndpoint && !options.dev) return null;

  const endpoint =
    explicitEndpoint ??
    (ingestKey ? EVERR_HOSTED_OTLP_ENDPOINT : DEFAULT_LOCAL_OTLP_ENDPOINT);
  const usesHostedIngest = !explicitEndpoint && Boolean(ingestKey);

  return {
    logsUrl: `${normalizeBaseEndpoint(endpoint)}/v1/logs`,
    headers:
      usesHostedIngest && ingestKey
        ? { Authorization: `Bearer ${ingestKey}` }
        : undefined,
  };
}

function clean(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeBaseEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "");
}
