import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Build-phase telemetry for the desktop/CLI release scripts.
 *
 * Spans join the GitHub Actions workflow trace that Everr's collector
 * receiver creates from webhooks. The trace and parent span ids must stay
 * bit-identical to the derivations in
 * collector/receiver/githubactionsreceiver/trace_event_handling.go
 * (generateTraceID, generateParentSpanID, generateJobSpanID); the receiver's
 * build_telemetry_vectors_test.go pins the same fixed vectors as
 * build-telemetry.test.ts so drift on either side fails its own suite.
 */

// In CI, spans join the workflow trace, so they carry the same service
// identity the receiver stamps on it (attributes.go: githubActionsServiceName
// and githubActionsServiceNamespace); the everr-build-telemetry scope and the
// cicd.pipeline.* attributes still distinguish build-script spans. Local dev
// builds keep their own service name so they never masquerade as CI.
const CI_SERVICE_NAME = "github-actions";
const CI_SERVICE_NAMESPACE = "cicd";
const LOCAL_SERVICE_NAME = "everr-desktop-build";
const LOCAL_SERVICE_NAMESPACE = "everr";
const BUILD_TELEMETRY_SCOPE_NAME = "everr-build-telemetry";
const DEFAULT_LOCAL_OTLP_ENDPOINT = "http://127.0.0.1:54318";
const EVERR_HOSTED_OTLP_ENDPOINT = "https://ingest.everr.dev";
const EXPORT_TIMEOUT_MS = 10_000;

const TRACE_ID_ENV = "EVERR_BUILD_TRACE_ID";
const PARENT_SPAN_ID_ENV = "EVERR_BUILD_PARENT_SPAN_ID";

const SPAN_KIND_INTERNAL = 1;
const STATUS_CODE_OK = 1;
const STATUS_CODE_ERROR = 2;

export type BuildTelemetryEnv = Partial<
  Record<
    | "EVERR_BUILD_PARENT_SPAN_ID"
    | "EVERR_BUILD_TRACE_ID"
    | "EVERR_CI_JOB_NAME"
    | "EVERR_INGEST_KEY"
    | "GITHUB_ACTIONS"
    | "GITHUB_REF_NAME"
    | "GITHUB_REPOSITORY"
    | "GITHUB_REPOSITORY_ID"
    | "GITHUB_RUN_ATTEMPT"
    | "GITHUB_RUN_ID"
    | "GITHUB_SHA"
    | "OTEL_EXPORTER_OTLP_ENDPOINT",
    string
  >
>;

type SpanAttributeValue = string | number | boolean;

type RecordedSpan = {
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  startTimeUnixNano: bigint;
  endTimeUnixNano: bigint;
  statusCode: number;
  statusMessage: string | undefined;
  attributes: Record<string, SpanAttributeValue>;
};

export type BuildTraceContext = {
  traceId: string;
  parentSpanId: string | undefined;
  source: "child-script" | "github-actions" | "local";
};

function sha256Hex(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

/** Mirrors generateTraceID: sha256("<repoId>@<runId>#<attempt>") hex chars [0, 32). */
export function deriveCiTraceId(repositoryId: string, runId: string, runAttempt: string) {
  return sha256Hex(`${repositoryId}@${runId}#${runAttempt}`).slice(0, 32);
}

/** Mirrors generateParentSpanID: sha256("<runId><attempt>s") hex chars [16, 32). */
export function deriveCiRunRootSpanId(runId: string, runAttempt: string) {
  return sha256Hex(`${runId}${runAttempt}s`).slice(16, 32);
}

/** Mirrors generateJobSpanID: sha256("<runId><attempt><jobName>") hex chars [16, 32). */
export function deriveCiJobSpanId(runId: string, runAttempt: string, jobName: string) {
  return sha256Hex(`${runId}${runAttempt}${jobName}`).slice(16, 32);
}

function cleanEnvValue(value: string | undefined) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function resolveBuildTraceContext(env: BuildTelemetryEnv): BuildTraceContext {
  const envTraceId = cleanEnvValue(env.EVERR_BUILD_TRACE_ID);
  const envParentSpanId = cleanEnvValue(env.EVERR_BUILD_PARENT_SPAN_ID);
  if (envTraceId && envParentSpanId) {
    return { traceId: envTraceId, parentSpanId: envParentSpanId, source: "child-script" };
  }

  const repositoryId = cleanEnvValue(env.GITHUB_REPOSITORY_ID);
  const runId = cleanEnvValue(env.GITHUB_RUN_ID);
  const runAttempt = cleanEnvValue(env.GITHUB_RUN_ATTEMPT);
  if (repositoryId && runId && runAttempt) {
    const jobName = cleanEnvValue(env.EVERR_CI_JOB_NAME);
    return {
      traceId: deriveCiTraceId(repositoryId, runId, runAttempt),
      parentSpanId: jobName
        ? deriveCiJobSpanId(runId, runAttempt, jobName)
        : deriveCiRunRootSpanId(runId, runAttempt),
      source: "github-actions",
    };
  }

  return {
    traceId: randomBytes(16).toString("hex"),
    parentSpanId: undefined,
    source: "local",
  };
}

export type BuildTelemetryExport = {
  url: string;
  headers: Record<string, string>;
};

export function resolveBuildTelemetryExport(env: BuildTelemetryEnv): BuildTelemetryExport | null {
  const explicitEndpoint = cleanEnvValue(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  // Hosted ingest only in CI: local desktop builds can have EVERR_INGEST_KEY in
  // .env for bundling into the app, and their build spans must stay local.
  const ingestKey =
    env.GITHUB_ACTIONS === "true" ? cleanEnvValue(env.EVERR_INGEST_KEY) : undefined;

  // In CI without an ingest key or explicit endpoint there is nothing to export
  // to; skip instead of warning about an unreachable local collector.
  if (env.GITHUB_ACTIONS === "true" && !explicitEndpoint && !ingestKey) {
    return null;
  }

  const endpoint = (
    explicitEndpoint ?? (ingestKey ? EVERR_HOSTED_OTLP_ENDPOINT : DEFAULT_LOCAL_OTLP_ENDPOINT)
  ).replace(/\/+$/, "");
  const usesHostedIngest = !explicitEndpoint && Boolean(ingestKey);

  return {
    url: `${endpoint}/v1/traces`,
    headers: {
      "content-type": "application/json",
      ...(usesHostedIngest && ingestKey ? { authorization: `Bearer ${ingestKey}` } : {}),
    },
  };
}

export function buildTelemetryResourceAttributes(env: BuildTelemetryEnv) {
  const inCi = env.GITHUB_ACTIONS === "true";
  const attributes: Record<string, SpanAttributeValue> = {
    "service.name": inCi ? CI_SERVICE_NAME : LOCAL_SERVICE_NAME,
    "service.namespace": inCi ? CI_SERVICE_NAMESPACE : LOCAL_SERVICE_NAMESPACE,
    "service.instance.id": randomUUID(),
    "deployment.environment.name": inCi ? "ci" : "development",
  };

  const sha = cleanEnvValue(env.GITHUB_SHA);
  attributes["service.version"] = sha ?? "local-dev";

  const repository = cleanEnvValue(env.GITHUB_REPOSITORY);
  if (repository) {
    attributes["vcs.repository.name"] = repository;
  }
  if (sha) {
    attributes["vcs.ref.head.revision"] = sha;
  }
  const refName = cleanEnvValue(env.GITHUB_REF_NAME);
  if (refName) {
    attributes["vcs.ref.head.name"] = refName;
  }
  const runId = cleanEnvValue(env.GITHUB_RUN_ID);
  if (runId) {
    attributes["cicd.pipeline.run.id"] = runId;
  }
  const jobName = cleanEnvValue(env.EVERR_CI_JOB_NAME);
  if (jobName) {
    attributes["cicd.pipeline.task.name"] = jobName;
  }

  return attributes;
}

function toOtlpAttributes(attributes: Record<string, SpanAttributeValue>) {
  return Object.entries(attributes).map(([key, value]) => {
    switch (typeof value) {
      case "boolean":
        return { key, value: { boolValue: value } };
      case "number":
        return {
          key,
          value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
        };
      default:
        return { key, value: { stringValue: value } };
    }
  });
}

function nowUnixNano() {
  return BigInt(Date.now()) * 1_000_000n;
}

export type PhaseHandle = {
  /** Trace context env vars for nested build scripts, so their spans attach under this phase span. */
  childEnv(): Record<string, string>;
};

export type BuildTelemetry = {
  /** Runs fn inside a span that is a child of the root build span. */
  phase<T>(
    name: string,
    fn: (span: PhaseHandle) => Promise<T>,
    attributes?: Record<string, SpanAttributeValue>,
  ): Promise<T>;
  setRootAttribute(key: string, value: SpanAttributeValue): void;
  /** Ends the root span and exports all spans. Never throws. */
  flush(error?: unknown): Promise<void>;
};

/** The phase-recording surface build helpers accept. */
export type BuildPhases = Pick<BuildTelemetry, "phase">;

/** Default for helpers whose callers do not record build telemetry. */
export const noopBuildPhases: BuildPhases = {
  phase: (_name, fn) => fn({ childEnv: () => ({}) }),
};

export function createBuildTelemetry({
  buildName,
  env = process.env as BuildTelemetryEnv,
}: {
  buildName: string;
  env?: BuildTelemetryEnv;
}): BuildTelemetry {
  const context = resolveBuildTraceContext(env);
  const rootSpanId = randomBytes(8).toString("hex");
  const rootStart = nowUnixNano();
  const rootAttributes: Record<string, SpanAttributeValue> = {};
  const spans: RecordedSpan[] = [];
  let flushed = false;

  const childEnvFor = (spanId: string) => ({
    [TRACE_ID_ENV]: context.traceId,
    [PARENT_SPAN_ID_ENV]: spanId,
  });

  return {
    async phase(name, fn, attributes = {}) {
      const spanId = randomBytes(8).toString("hex");
      const startTimeUnixNano = nowUnixNano();
      let statusCode = STATUS_CODE_OK;
      let statusMessage: string | undefined;
      try {
        return await fn({ childEnv: () => childEnvFor(spanId) });
      } catch (error) {
        statusCode = STATUS_CODE_ERROR;
        statusMessage = errorMessage(error);
        throw error;
      } finally {
        spans.push({
          spanId,
          parentSpanId: rootSpanId,
          name,
          startTimeUnixNano,
          endTimeUnixNano: nowUnixNano(),
          statusCode,
          statusMessage,
          attributes,
        });
      }
    },

    setRootAttribute(key, value) {
      rootAttributes[key] = value;
    },

    async flush(error) {
      if (flushed) {
        return;
      }
      flushed = true;

      spans.push({
        spanId: rootSpanId,
        parentSpanId: context.parentSpanId,
        name: buildName,
        startTimeUnixNano: rootStart,
        endTimeUnixNano: nowUnixNano(),
        statusCode: error === undefined ? STATUS_CODE_OK : STATUS_CODE_ERROR,
        statusMessage: error === undefined ? undefined : errorMessage(error),
        attributes: rootAttributes,
      });

      const exportTarget = resolveBuildTelemetryExport(env);
      if (!exportTarget) {
        return;
      }
      const payload = buildOtlpTracePayload({ env, traceId: context.traceId, spans });

      try {
        const response = await fetch(exportTarget.url, {
          method: "POST",
          headers: exportTarget.headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
        });
        if (!response.ok) {
          console.error(
            `Build telemetry export to ${exportTarget.url} failed with HTTP ${response.status}.`,
          );
        }
      } catch (exportError) {
        console.error(
          `Build telemetry export to ${exportTarget.url} failed: ${errorMessage(exportError)}`,
        );
      }
    },
  };
}

/** Creates telemetry for a build script, runs it, and always flushes (with error status on failure). */
export async function withBuildTelemetry<T>(
  buildName: string,
  fn: (telemetry: BuildTelemetry) => Promise<T>,
): Promise<T> {
  const telemetry = createBuildTelemetry({ buildName });
  try {
    const result = await fn(telemetry);
    await telemetry.flush();
    return result;
  } catch (error) {
    await telemetry.flush(error);
    throw error;
  }
}

export function buildOtlpTracePayload({
  env,
  traceId,
  spans,
}: {
  env: BuildTelemetryEnv;
  traceId: string;
  spans: RecordedSpan[];
}) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: toOtlpAttributes(buildTelemetryResourceAttributes(env)),
        },
        scopeSpans: [
          {
            scope: { name: BUILD_TELEMETRY_SCOPE_NAME },
            spans: spans.map((span) => ({
              traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: SPAN_KIND_INTERNAL,
              startTimeUnixNano: span.startTimeUnixNano.toString(),
              endTimeUnixNano: span.endTimeUnixNano.toString(),
              attributes: toOtlpAttributes(span.attributes),
              status: {
                code: span.statusCode,
                ...(span.statusMessage ? { message: span.statusMessage } : {}),
              },
            })),
          },
        ],
      },
    ],
  };
}
