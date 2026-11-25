import { productClient } from "@composition/client";

const TELEMETRY_SERVICE_NAME = "everr-dev-app";
const TELEMETRY_SERVICE_NAMESPACE = "everr";
const DEFAULT_LOCAL_OTLP_ENDPOINT = "http://127.0.0.1:54318";

export type TelemetrySignal = "traces" | "metrics" | "logs";

export type TelemetryEnv = Partial<{
  DEPLOYMENT_ENVIRONMENT: string;
  EVERR_PROFILING: string;
  EVERR_INGEST_ENDPOINT: string;
  EVERR_INGEST_KEY: string;
  GITHUB_REPOSITORY: string;
  GITHUB_SERVER_URL: string;
  GITHUB_SHA: string;
  NODE_ENV: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  SERVICE_VERSION: string;
  VCS_REF_HEAD_REVISION: string;
  VCS_REPOSITORY_URL_FULL: string;
  VERCEL_ENV: string;
  VERCEL_GIT_COMMIT_SHA: string;
  VERCEL_GIT_PROVIDER: string;
  VERCEL_GIT_REPO_OWNER: string;
  VERCEL_GIT_REPO_SLUG: string;
}>;

export type TelemetryConfig = {
  endpoint: string;
  headers: Record<string, string> | undefined;
  resourceAttributes: Record<string, string>;
};

export function resolveBrowserTelemetryConfig(env: { endpoint?: string; publicKey?: string }) {
  const endpoint =
    cleanEnvValue(env.endpoint) ??
    (cleanEnvValue(env.publicKey) ? productClient.telemetryEndpoint : undefined);
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
    ? (everrEndpoint ?? productClient.telemetryEndpoint)
    : undefined;
  const localDevelopmentEndpoint = isLocalDevelopment(env)
    ? DEFAULT_LOCAL_OTLP_ENDPOINT
    : undefined;
  const selectedEndpoint = explicitEndpoint ?? everrIngestEndpoint ?? localDevelopmentEndpoint;
  if (!selectedEndpoint) return null;

  const endpoint = normalizeBaseEndpoint(selectedEndpoint);
  const usesEverrIngest = !explicitEndpoint && Boolean(ingestKey && everrIngestEndpoint);

  return {
    endpoint,
    headers: usesEverrIngest && ingestKey ? { Authorization: `Bearer ${ingestKey}` } : undefined,
    resourceAttributes: telemetryResourceAttributes(env, serviceInstanceId),
  };
}

export function telemetryResourceAttributes(env: TelemetryEnv, serviceInstanceId: string) {
  const serviceVersion =
    cleanEnvValue(env.SERVICE_VERSION) ??
    cleanEnvValue(env.VERCEL_GIT_COMMIT_SHA) ??
    cleanEnvValue(env.GITHUB_SHA) ??
    localServiceVersion(env);
  const deploymentEnvironment =
    cleanEnvValue(env.DEPLOYMENT_ENVIRONMENT) ??
    cleanEnvValue(env.VERCEL_ENV) ??
    cleanEnvValue(env.NODE_ENV);

  const repositoryUrl = vcsRepositoryUrl(env);
  const revision =
    cleanEnvValue(env.VCS_REF_HEAD_REVISION) ??
    cleanEnvValue(env.VERCEL_GIT_COMMIT_SHA) ??
    cleanEnvValue(env.GITHUB_SHA);

  return {
    ...(deploymentEnvironment ? { "deployment.environment.name": deploymentEnvironment } : {}),
    "service.instance.id": serviceInstanceId,
    "service.name": TELEMETRY_SERVICE_NAME,
    "service.namespace": TELEMETRY_SERVICE_NAMESPACE,
    ...(serviceVersion ? { "service.version": serviceVersion } : {}),
    ...(repositoryUrl ? { "vcs.repository.url.full": repositoryUrl } : {}),
    ...(revision ? { "vcs.ref.head.revision": revision } : {}),
  };
}

const VERCEL_GIT_HOSTS: Record<string, string> = {
  bitbucket: "https://bitbucket.org",
  github: "https://github.com",
  gitlab: "https://gitlab.com",
};

function vcsRepositoryUrl(env: TelemetryEnv) {
  const explicit = cleanEnvValue(env.VCS_REPOSITORY_URL_FULL);
  if (explicit) return explicit;
  const githubRepository = cleanEnvValue(env.GITHUB_REPOSITORY);
  if (githubRepository) {
    const server = cleanEnvValue(env.GITHUB_SERVER_URL) ?? "https://github.com";
    return `${normalizeBaseEndpoint(server)}/${githubRepository}`;
  }
  const owner = cleanEnvValue(env.VERCEL_GIT_REPO_OWNER);
  const slug = cleanEnvValue(env.VERCEL_GIT_REPO_SLUG);
  const host = VERCEL_GIT_HOSTS[cleanEnvValue(env.VERCEL_GIT_PROVIDER) ?? "github"];
  return owner && slug && host ? `${host}/${owner}/${slug}` : undefined;
}

export function signalUrl(endpoint: string, signal: TelemetrySignal) {
  const normalized = normalizeBaseEndpoint(endpoint);
  const signalSpecificEndpoint = /\/v1\/(traces|metrics|logs)$/.exec(normalized);

  if (signalSpecificEndpoint) {
    return normalized.replace(/\/v1\/(traces|metrics|logs)$/, `/v1/${signal}`);
  }

  return `${normalized}/v1/${signal}`;
}

// Profiles need a collector with the `service.profilesSupport` gate, so they
// stay opt-in outside local development.
export function profilingEnabled(env: TelemetryEnv) {
  const flag = cleanEnvValue(env.EVERR_PROFILING);
  return flag ? flag === "true" : isLocalDevelopment(env);
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
