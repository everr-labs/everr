import { dirname } from "node:path";
import { heap, SourceMapper, time } from "@datadog/pprof";
import { context } from "@opentelemetry/api";
import { parseKeyPairsIntoRecord, suppressTracing } from "@opentelemetry/core";
import { pprofToOtlp } from "./otlp.js";
import { findSourceRoot } from "./source-root.js";
import { LOW_CARDINALITY_LABELS, sampleLabels } from "./span-context.js";

// 100 Hz, the rate pprof and most continuous profilers sample at.
const WALL_INTERVAL_MICROS = 10_000;
// Node's and Datadog's default: one sampled allocation per 512 KiB.
const HEAP_INTERVAL_BYTES = 512 * 1024;
const HEAP_STACK_DEPTH = 64;
const DEFAULT_EXPORT_INTERVAL_MS = 15_000;
const DEFAULT_ENDPOINT = "http://localhost:4318";

// `sample` is the wall profiler's hit count; wall time carries the same signal.
const WALL_SAMPLE_TYPES = ["wall", "cpu"];
const HEAP_SAMPLE_TYPES = ["inuse_space", "inuse_objects"];

export type ProfilerOptions = {
  /** The full profiles URL. Wins over `endpoint`. */
  url?: string;
  /**
   * The OTLP/HTTP base endpoint; profiles go to `<endpoint>/v1development/profiles`.
   * Defaults to `OTEL_EXPORTER_OTLP_ENDPOINT`, then `http://localhost:4318`.
   */
  endpoint?: string;
  /** Defaults to `OTEL_EXPORTER_OTLP_HEADERS`. */
  headers?: Record<string, string>;
  /** Use the SDK's resource attributes, so profiles join the service's other signals. */
  resourceAttributes?: Record<string, string>;
  /**
   * File names under this directory are sent relative to it, to match source
   * links. Defaults to `EVERR_PROFILER_SOURCE_ROOT`, then the nearest ancestor
   * of the working directory holding `.git` or `pnpm-workspace.yaml`.
   */
  sourceRoot?: string;
  /** Where to look for source maps. Defaults to the entry script's directory. */
  sourceMapDirs?: string[];
  /** How often a profile is sent. Defaults to 15 seconds. */
  exportIntervalMillis?: number;
};

export type Profiler = { shutdown: () => Promise<void> };

/**
 * Continuous wall-time, CPU-time and heap profiling, exported as OTLP profiles.
 * Wall and CPU samples taken inside a span link to it when the SDK uses
 * `ProfilingContextManager`.
 */
export async function startProfiler(options: ProfilerOptions = {}): Promise<Profiler> {
  const env = process.env;
  const url = options.url ?? profilesUrl(options.endpoint ?? env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const headers = options.headers ?? parseKeyPairsIntoRecord(env.OTEL_EXPORTER_OTLP_HEADERS);
  const resourceAttributes = {
    "service.name": env.OTEL_SERVICE_NAME || "unknown_service:node",
    ...options.resourceAttributes,
  };
  const sourceRoot =
    options.sourceRoot ?? (env.EVERR_PROFILER_SOURCE_ROOT || findSourceRoot(process.cwd()));
  const sourceMapper = await loadSourceMaps(options.sourceMapDirs);
  const exportIntervalMillis = options.exportIntervalMillis ?? DEFAULT_EXPORT_INTERVAL_MS;

  time.start({
    intervalMicros: WALL_INTERVAL_MICROS,
    sourceMapper,
    withContexts: true,
    useCPED: true,
    collectCpuTime: true,
  });
  heap.start(HEAP_INTERVAL_BYTES, HEAP_STACK_DEPTH);

  const flush = async (restart: boolean) => {
    const wall = time.stop(restart, sampleLabels, LOW_CARDINALITY_LABELS);
    const heapProfile = heap.profile(undefined, sourceMapper);
    const request = pprofToOtlp(
      [
        { profile: wall, sampleTypes: WALL_SAMPLE_TYPES },
        // A heap profile is a snapshot of what is live now; it covers the same
        // window so the two line up on the timeline.
        {
          profile: Object.assign(heapProfile, {
            timeNanos: wall.timeNanos,
            durationNanos: wall.durationNanos,
          }),
          sampleTypes: HEAP_SAMPLE_TYPES,
        },
      ],
      resourceAttributes,
      { sourceRoot },
    );
    await post(url, headers, await request.encodeAsync());
  };

  let pending: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    pending = pending.then(() => flush(true)).catch(reportExportError);
  }, exportIntervalMillis);
  timer.unref();

  return {
    async shutdown() {
      clearInterval(timer);
      await pending;
      await flush(false).catch(reportExportError);
      heap.stop();
    },
  };
}

// OTLP profiles are `v1development`, so the path is not `/v1/profiles`.
function profilesUrl(endpoint: string | undefined) {
  const base = (endpoint?.trim() || DEFAULT_ENDPOINT)
    .replace(/\/+$/, "")
    .replace(/\/v1\/(traces|metrics|logs)$/, "");
  return `${base}/v1development/profiles`;
}

// Bundled or compiled servers keep maps next to the entry script, and the maps
// point back at the TypeScript sources. Without maps frames stay as they ran.
async function loadSourceMaps(dirs: string[] | undefined): Promise<SourceMapper | undefined> {
  const entry = process.argv[1];
  const searchDirs = dirs ?? (entry ? [dirname(entry)] : []);
  if (searchDirs.length === 0) return undefined;
  return SourceMapper.create(searchDirs).catch(() => undefined);
}

async function post(url: string, headers: Record<string, string> | undefined, body: Uint8Array) {
  // Without this the fetch instrumentation traces every export.
  const response = await context.with(suppressTracing(context.active()), () =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-protobuf", ...headers },
      body: Buffer.from(body),
      signal: AbortSignal.timeout(10_000),
    }),
  );
  if (!response.ok) {
    throw new Error(`profiles export failed: ${response.status} ${await response.text()}`);
  }
}

let reportedExportError = false;

// Once per process: a collector without profiles support fails every window.
function reportExportError(error: unknown) {
  if (reportedExportError) return;
  reportedExportError = true;
  console.warn("[@everr/otel-profiler] profile export failed", error);
}
