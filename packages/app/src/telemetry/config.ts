import { getDefaultTelemetryEndpoint } from "@app/telemetry";

const TELEMETRY_SERVICE_NAME = "everr-dev-app";
const TELEMETRY_SERVICE_NAMESPACE = "everr";
const DEFAULT_LOCAL_OTLP_ENDPOINT = "http://127.0.0.1:54318";

export type TelemetrySignal = "traces" | "metrics" | "logs";

export type TelemetryEnv = Partial<{
  DEPLOYMENT_ENVIRONMENT: string;
  EVERR_INGEST_ENDPOINT: string;
  EVERR_INGEST_KEY: string;
  GITHUB_SHA: string;
  NODE_ENV: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  SERVICE_VERSION: string;
  VERCEL_ENV: string;
  VERCEL_GIT_COMMIT_SHA: string;
}>;

export type TelemetryConfig = {
  endpoint: string;
  headers: Record<string, string> | undefined;
  resourceAttributes: Record<string, string>;
};

export function resolveBrowserTelemetryConfig(env: {
  endpoint?: string;
  publicKey?: string;
}) {
  const endpoint =
    cleanEnvValue(env.endpoint) ??
    (cleanEnvValue(env.publicKey) ? getDefaultTelemetryEndpoint() : undefined);
  return {
    endpoint,
    ingestKey: endpoint ? cleanEnvValue(env.publicKey) : undefined,
  };
}

export function resolveTelemetryConfig(
  env: TelemetryEnv,
  serviceInstanceId: string,
): TelemetryConfig | null {
  const explicitEndpoint = cleanEnvValue(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const everrEndpoint = cleanEnvValue(env.EVERR_INGEST_ENDPOINT);
  const ingestKey = cleanEnvValue(env.EVERR_INGEST_KEY);

  const everrIngestEndpoint = ingestKey
    ? (everrEndpoint ?? getDefaultTelemetryEndpoint())
    : undefined;
  const localDevelopmentEndpoint = isLocalDevelopment(env)
    ? DEFAULT_LOCAL_OTLP_ENDPOINT
    : undefined;
  const selectedEndpoint =
    explicitEndpoint ?? everrIngestEndpoint ?? localDevelopmentEndpoint;
  if (!selectedEndpoint) return null;

  const endpoint = normalizeBaseEndpoint(selectedEndpoint);
  const usesEverrIngest =
    !explicitEndpoint && Boolean(ingestKey && everrIngestEndpoint);

  return {
    endpoint,
    headers:
      usesEverrIngest && ingestKey
        ? { Authorization: `Bearer ${ingestKey}` }
        : undefined,
    resourceAttributes: telemetryResourceAttributes(env, serviceInstanceId),
  };
}

export function telemetryResourceAttributes(
  env: TelemetryEnv,
  serviceInstanceId: string,
) {
  const serviceVersion =
    cleanEnvValue(env.SERVICE_VERSION) ??
    cleanEnvValue(env.VERCEL_GIT_COMMIT_SHA) ??
    cleanEnvValue(env.GITHUB_SHA) ??
    localServiceVersion(env);
  const deploymentEnvironment =
    cleanEnvValue(env.DEPLOYMENT_ENVIRONMENT) ??
    cleanEnvValue(env.VERCEL_ENV) ??
    cleanEnvValue(env.NODE_ENV);

  return {
    ...(deploymentEnvironment
      ? { "deployment.environment.name": deploymentEnvironment }
      : {}),
    "service.instance.id": serviceInstanceId,
    "service.name": TELEMETRY_SERVICE_NAME,
    "service.namespace": TELEMETRY_SERVICE_NAMESPACE,
    ...(serviceVersion ? { "service.version": serviceVersion } : {}),
  };
}

export function signalUrl(endpoint: string, signal: TelemetrySignal) {
  const normalized = normalizeBaseEndpoint(endpoint);
  const signalSpecificEndpoint = /\/v1\/(traces|metrics|logs)$/.exec(
    normalized,
  );

  if (signalSpecificEndpoint) {
    return normalized.replace(/\/v1\/(traces|metrics|logs)$/, `/v1/${signal}`);
  }

  return `${normalized}/v1/${signal}`;
}

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeBaseEndpoint(endpoint: string) {
  return endpoint.replace(/\/+$/, "");
}

function isLocalDevelopment(env: TelemetryEnv) {
  const nodeEnv = cleanEnvValue(env.NODE_ENV);
  return nodeEnv === "development" || nodeEnv === "test";
}

function localServiceVersion(env: TelemetryEnv) {
  return isLocalDevelopment(env) ? "local-dev" : undefined;
}
