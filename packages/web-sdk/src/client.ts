import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  type LogRecordExporter,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { attributionAttributes } from "./attribution.js";
import { resolveCapture } from "./capture.js";
import { resolveTransport } from "./config.js";
import { createEnvelopeProcessor } from "./envelope.js";
import { startPageviewTracking } from "./pageview.js";
import { SessionContext } from "./session.js";
import type {
  ConsentedClient,
  ConsentedInitOptions,
  CookielessClient,
  CookielessInitOptions,
  EverrClient,
  InitOptions,
} from "./types.js";

declare const __PACKAGE_VERSION__: string | undefined;
const SDK_VERSION =
  typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev";
const SDK_NAME = "@everr/web-sdk";

// Same tuning as the web app's browser telemetry client.
const BATCH_OPTIONS = {
  maxQueueSize: 100,
  maxExportBatchSize: 32,
  scheduledDelayMillis: 5_000,
  exportTimeoutMillis: 30_000,
};

/** Test seam: inject an in-memory exporter instead of the OTLP transport. */
export type InitOverrides = {
  exporter?: LogRecordExporter;
};

export function init(options: CookielessInitOptions): CookielessClient;
export function init(options: ConsentedInitOptions): ConsentedClient;
export function init(options: InitOptions): EverrClient {
  return initInternal(options);
}

export function initInternal(
  options: InitOptions,
  overrides?: InitOverrides,
): EverrClient {
  if (options.mode === "consented") {
    throw new Error(
      '[@everr/web-sdk] mode "consented" is not implemented yet; use mode "cookieless".',
    );
  }

  // SSR guard: the SDK is browser-only; server renders get an inert client.
  if (typeof window === "undefined") return inertClient(options.mode);

  const exporter = overrides?.exporter ?? createOtlpExporter(options);
  // Structural no-op: a keyless production build never constructs a
  // provider, so nothing can ever issue a network request.
  if (!exporter) return inertClient(options.mode);

  const capture = resolveCapture(options.capture);
  const session = new SessionContext(
    window.location.href,
    document.referrer || undefined,
  );

  const provider = new LoggerProvider({
    resource: resourceFromAttributes(resourceAttributes(options)),
    processors: [
      createEnvelopeProcessor(
        session,
        attributionAttributes(window.location.href),
      ),
      overrides?.exporter
        ? new SimpleLogRecordProcessor(exporter)
        : new BatchLogRecordProcessor(exporter, BATCH_OPTIONS),
    ],
  });
  const logger = provider.getLogger(SDK_NAME, SDK_VERSION);

  const cleanups: Array<() => void> = [];
  if (capture.pageviews) {
    cleanups.push(startPageviewTracking(logger, session));
  }

  return {
    mode: options.mode,
    flush: () => provider.forceFlush(),
    shutdown: async () => {
      for (const cleanup of cleanups) cleanup();
      await provider.shutdown();
    },
  };
}

function createOtlpExporter(
  options: InitOptions,
): LogRecordExporter | undefined {
  const transport = resolveTransport(options);
  if (!transport) return undefined;
  return new OTLPLogExporter({
    url: transport.logsUrl,
    headers: transport.headers,
  });
}

function resourceAttributes(
  options: InitOptions,
): Record<string, string | number> {
  // Viewport is deliberately absent: it changes on resize, so it rides the
  // click payload per event instead of being frozen into the resource.
  return {
    "service.name": options.serviceName,
    "service.namespace": "everr",
    "service.version": options.serviceVersion ?? SDK_VERSION,
    ...(options.deploymentEnvironment
      ? { "deployment.environment.name": options.deploymentEnvironment }
      : {}),
    "everr.sdk.name": SDK_NAME,
    "everr.sdk.version": SDK_VERSION,
    "user_agent.original": navigator.userAgent,
    "everr.screen.width": window.screen.width,
    "everr.screen.height": window.screen.height,
    "everr.timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
    "everr.language": navigator.language,
  };
}

function inertClient(mode: InitOptions["mode"]): EverrClient {
  return {
    mode,
    flush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}
