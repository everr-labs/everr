import { vi } from "vitest";
import { init } from "./client.js";
import type { CookielessInitOptions, EverrClient } from "./types.js";

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

export type OtlpBatch = {
  keepalive: boolean;
  resource: Array<{ key: string; value: Record<string, unknown> }>;
  records: OtlpRecord[];
};

/** Stubs the global fetch; returns the live list of captured batches. */
function stubOtlpFetch(): OtlpBatch[] {
  const batches: OtlpBatch[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body));
      const resourceLog = payload.resourceLogs[0];
      batches.push({
        keepalive: Boolean(init?.keepalive),
        resource: resourceLog.resource.attributes,
        records: resourceLog.scopeLogs[0].logRecords,
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  return batches;
}

/** Flattens a record's OTLP attributes into plain key/value pairs. */
export function attrs(record: OtlpRecord): Record<string, unknown> {
  return Object.fromEntries(
    record.attributes.map(({ key, value }) => [key, Object.values(value)[0]]),
  );
}

/**
 * The one true test boot: stubs fetch and inits a cookieless dev client, so
 * every test file exercises the same init shape.
 */
export function startClient(
  options?: Partial<Omit<CookielessInitOptions, "mode">>,
): [client: EverrClient, batches: OtlpBatch[]] {
  const batches = stubOtlpFetch();
  const client = init({
    mode: "cookieless",
    serviceName: "everr-docs-test",
    dev: true,
    ...options,
  });
  return [client, batches];
}
