import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSend } from "./config.js";
import { createEmitter } from "./emitter.js";

// Property tests for the emitter's algorithmic core: the exit-flush budget
// truncation and the OTLP attribute mapping. Generated inputs probe the
// budget boundaries (giant single records, sizes straddling the limit) that
// hand-picked examples cannot enumerate.

const EXIT_BUDGET = 64_000;
const SPAN_BUDGET = EXIT_BUDGET / 4;

type Sent = {
  url: string;
  keepalive: boolean | undefined;
  bytes: number;
  logNames: string[];
  spanNames: string[];
  attributes: Array<{ key: string; value: Record<string, unknown> }>;
};

function makeEmitter() {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body);
      const payload = JSON.parse(body);
      const records = payload.resourceLogs?.[0].scopeLogs[0].logRecords;
      sent.push({
        url: String(url),
        keepalive: init?.keepalive,
        bytes: new Blob([body]).size,
        logNames: records?.map((r: { eventName: string }) => r.eventName) ?? [],
        spanNames:
          payload.resourceSpans?.[0].scopeSpans[0].spans.map(
            (s: { name: string }) => s.name,
          ) ?? [],
        attributes: records?.[0]?.attributes ?? [],
      });
      return Promise.resolve(new Response(null, { status: 200 }));
    }),
  );
  const emitter = createEmitter(
    fetchSend(
      "https://ingest.example/v1/logs",
      "https://ingest.example/v1/traces",
      undefined,
    ),
    true,
    {},
    { name: "@everr/otel-web", version: "test" },
    () => ({}),
  );
  return { sent, emitter };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// Batches stay under the 32-record regular-flush trigger, so every record
// rides the exit path being tested.
const sizes = (max: number) =>
  fc.array(fc.integer({ min: 0, max: 30_000 }), {
    minLength: 1,
    maxLength: max,
  });

describe("exit-flush budget", () => {
  it("keeps every keepalive payload within its budget share, or one lone record", () => {
    vi.useFakeTimers();
    fc.assert(
      fc.property(sizes(15), sizes(15), (logSizes, spanSizes) => {
        const { sent, emitter } = makeEmitter();
        const [emit, , exitFlush, emitSpan] = emitter;
        for (const [i, size] of logSizes.entries()) {
          emit(`log-${i}`, { filler: "x".repeat(size) });
        }
        for (const [i, size] of spanSizes.entries()) {
          emitSpan("a".repeat(32), "b".repeat(16), `span-${i}`, 1, 2, {
            filler: "x".repeat(size),
          });
        }
        exitFlush();
        const exits = sent.filter((b) => b.keepalive);
        const spans = exits.find((b) => b.url.endsWith("/v1/traces"));
        const logs = exits.find((b) => b.url.endsWith("/v1/logs"));
        // Spans: at most a quarter of the budget, unless a single span alone
        // exceeds it (whole-record truncation never drops the last one).
        if (spans && spans.spanNames.length > 1) {
          expect(spans.bytes).toBeLessThanOrEqual(SPAN_BUDGET);
        }
        // Logs fill whatever the spans left of the budget, same lone-record
        // exemption.
        if (logs && logs.logNames.length > 1) {
          expect(logs.bytes).toBeLessThanOrEqual(
            EXIT_BUDGET - (spans?.bytes ?? 0),
          );
        }
        // Survivors are always the oldest prefix, in emit order.
        const survivors = (kept: string[], prefix: string, total: number) => {
          expect(kept).toEqual(
            Array.from({ length: kept.length }, (_, i) => `${prefix}-${i}`),
          );
          expect(kept.length).toBeGreaterThanOrEqual(1);
          expect(kept.length).toBeLessThanOrEqual(total);
        };
        survivors(logs?.logNames ?? [], "log", logSizes.length);
        survivors(spans?.spanNames ?? [], "span", spanSizes.length);
      }),
      { numRuns: 50 },
    );
  });

  it("leaves both queues empty: a later flush posts nothing", () => {
    vi.useFakeTimers();
    fc.assert(
      fc.property(sizes(10), sizes(10), (logSizes, spanSizes) => {
        const { sent, emitter } = makeEmitter();
        const [emit, flush, exitFlush, emitSpan] = emitter;
        for (const size of logSizes) emit("log", { filler: "x".repeat(size) });
        for (const size of spanSizes) {
          emitSpan("a".repeat(32), "b".repeat(16), "span", 1, 2, {
            filler: "x".repeat(size),
          });
        }
        exitFlush();
        const posted = sent.length;
        void flush();
        expect(sent.length).toBe(posted);
      }),
      { numRuns: 25 },
    );
  });
});

describe("OTLP attribute mapping", () => {
  const attrValue = fc.oneof(
    fc.string(),
    fc.boolean(),
    fc.integer(),
    fc
      .double({ noNaN: true, noDefaultInfinity: true })
      .filter((n) => !Number.isInteger(n)),
    fc.constant(null),
    fc.constant(undefined),
  );

  it("types every value into its OTLP arm and drops the nullish", () => {
    vi.useFakeTimers();
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1 }), attrValue, { maxKeys: 12 }),
        (record) => {
          const { sent, emitter } = makeEmitter();
          const [emit, flush] = emitter;
          emit("probe", record);
          void flush();
          const wire = new Map(
            sent[0].attributes.map(({ key, value }) => [key, value]),
          );
          for (const [key, value] of Object.entries(record)) {
            if (value == null) {
              expect(wire.has(key)).toBe(false);
            } else if (typeof value === "string") {
              expect(wire.get(key)).toEqual({ stringValue: value });
            } else if (typeof value === "boolean") {
              expect(wire.get(key)).toEqual({ boolValue: value });
            } else if (Number.isInteger(value)) {
              expect(wire.get(key)).toEqual({ intValue: String(value) });
            } else {
              expect(wire.get(key)).toEqual({ doubleValue: value });
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
