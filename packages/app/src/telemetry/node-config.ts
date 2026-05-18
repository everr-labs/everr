export type NodeTelemetryConfig = {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName: string;
  deploymentEnvironment: string;
};

const DEFAULT_LOCAL_COLLECTOR_ENDPOINT = "http://127.0.0.1:54318";
const EVERR_CLOUD_OTLP_ENDPOINT = "https://ingest.everr.dev";

export function getNodeTelemetryConfig(
  env: NodeJS.ProcessEnv,
): NodeTelemetryConfig | null {
  const deploymentEnvironment =
    env.OTEL_DEPLOYMENT_ENVIRONMENT || env.NODE_ENV || "development";
  const isProduction = deploymentEnvironment === "production";
  const endpoint =
    env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    env.VITE_OTEL_EXPORTER_OTLP_ENDPOINT ||
    (env.EVERR_INGEST_KEY
      ? EVERR_CLOUD_OTLP_ENDPOINT
      : isProduction
        ? undefined
        : DEFAULT_LOCAL_COLLECTOR_ENDPOINT);

  if (!endpoint) {
    return null;
  }

  const headers = parseOtelHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);

  if (env.EVERR_INGEST_KEY) {
    headers.Authorization = `Bearer ${env.EVERR_INGEST_KEY}`;
  }

  return {
    endpoint,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    serviceName: env.OTEL_SERVICE_NAME || "everr-web-node",
    deploymentEnvironment,
  };
}

function parseOtelHeaders(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .flatMap((part) => {
        const separator = part.indexOf("=");

        if (separator === -1) {
          return [];
        }

        return [
          [
            part.slice(0, separator).trim(),
            decodeHeaderValue(part.slice(separator + 1).trim()),
          ],
        ];
      }),
  );
}

function decodeHeaderValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
