import { vi } from "vitest";
import { init } from "./client.js";
import type { EverrClient, InitOptions } from "./types.js";

// Shared OTLP capture harness for the package's integration tests: stubs
// the global fetch (which the emitter reads at call time) and decodes each
// posted batch into plain shapes tests can assert on.

export type OtlpRecord = {
  timeUnixNano: string;
  severityNumber: number;
  eventName: string;
  body?: unknown;
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

export type OtlpSpan = {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: { code?: number };
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

export type OtlpBatch = {
  url: string;
  keepalive: boolean;
  resource: Array<{ key: string; value: Record<string, unknown> }>;
  records: OtlpRecord[];
  spans: OtlpSpan[];
};

/** Stubs the global fetch; returns the live list of captured batches. */
function stubOtlpFetch(): OtlpBatch[] {
  const batches: OtlpBatch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const resourceLog = payload.resourceLogs?.[0];
      const resourceSpan = payload.resourceSpans?.[0];
      batches.push({
        url: String(url),
        keepalive: Boolean(init?.keepalive),
        resource: (resourceLog ?? resourceSpan).resource.attributes,
        records: resourceLog?.scopeLogs[0].logRecords ?? [],
        spans: resourceSpan?.scopeSpans[0].spans ?? [],
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  return batches;
}

/** Flattens a record's or span's OTLP attributes into plain key/value pairs. */
export function attrs(record: OtlpRecord | OtlpSpan): Record<string, unknown> {
  return Object.fromEntries(
    record.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
}

/**
 * The one true test boot: stubs fetch and inits a memory-persistence dev
 * client, so tests leave no storage behind unless they opt in.
 */
export function startClient(
  options?: Partial<InitOptions>,
): [client: EverrClient, batches: OtlpBatch[]] {
  const batches = stubOtlpFetch();
  return [init({ persistence: "memory", ...DEFAULTS, ...options }), batches];
}

/**
 * The localStorage-persistence boot, deliberately omitting the flag so it
 * also covers the SDK default. Tests must clear localStorage between runs
 * (durable identity is the whole point of this persistence).
 */
export function startPersistentClient(
  options?: Partial<InitOptions>,
): [client: EverrClient, batches: OtlpBatch[]] {
  const batches = stubOtlpFetch();
  return [init({ ...DEFAULTS, ...options }), batches];
}

const DEFAULTS = { serviceName: "everr-docs-test", dev: true };

/** The id shape every minted visitor/session id must match. */
export const UNIQUE_ID = /^\d+-\d{13}$/;
