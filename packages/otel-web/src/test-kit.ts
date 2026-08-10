import { vi } from "vitest";
import { WebSDK } from "./client.js";
import { errors } from "./instrumentations/errors/index.js";
import { interactions } from "./instrumentations/interactions/index.js";
import { network } from "./instrumentations/network/index.js";
import { pageviews } from "./instrumentations/pageviews/index.js";
import { performance as performanceInstrumentation } from "./instrumentations/performance/index.js";
import type { Instrumentation } from "./instrumentations/runtime.js";
import type { WebSDKOptions } from "./types.js";

/** All the built-in instrumentations. The tests use this set by default. */
export const allInstrumentations = (): Instrumentation[] => [
  errors(),
  pageviews(),
  interactions(),
  performanceInstrumentation(),
  network(),
];

// The shared tools that capture the OTLP data in the integration tests of this
// package. They replace the global fetch, which the emitter reads at each call.
// Then they change each batch into a simple structure, and a test can examine
// that structure.

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

/** Replaces the global fetch. It returns the list of the captured batches, and
 * the code adds each new batch to that list. */
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

/** Changes the OTLP attributes of a record or a span into usual key and value
 * pairs. */
export function attrs(record: OtlpRecord | OtlpSpan): Record<string, unknown> {
  return Object.fromEntries(
    record.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
}

/**
 * The standard start for a test. It replaces fetch and constructs a development
 * client with the memory store. Thus a test writes nothing to the store, but a
 * test can select a different store.
 */
export function startClient(
  options?: Partial<WebSDKOptions>,
): [client: WebSDK, batches: OtlpBatch[]] {
  const batches = stubOtlpFetch();
  return [
    new WebSDK({ persistence: "memory", ...DEFAULTS, ...options }),
    batches,
  ];
}

/**
 * The start with the localStorage store. This function does not set the
 * persistence option, and this is correct: thus it also examines the default of
 * the SDK. A test must clear localStorage before the next test, because this
 * store keeps the identity.
 */
export function startPersistentClient(
  options?: Partial<WebSDKOptions>,
): [client: WebSDK, batches: OtlpBatch[]] {
  const batches = stubOtlpFetch();
  return [new WebSDK({ ...DEFAULTS, ...options }), batches];
}

const DEFAULTS = {
  serviceName: "everr-docs-test",
  dev: true,
  get instrumentations() {
    return allInstrumentations();
  },
};

/** The structure that each visitor id and each session id must have. */
export const UNIQUE_ID = /^\d+-\d{13}$/;
