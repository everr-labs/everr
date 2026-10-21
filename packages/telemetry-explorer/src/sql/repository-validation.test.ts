import { describe, expect, it, vi } from "vite-plus/test";
import { LogsRepository } from "../logs/data/repository";
import { TracesRepository } from "../traces/data/repository";
import { ErrorsRepository } from "../errors/data/repository";

const timeRange = { from: "now-1h", to: "now" };
const logsInput = { timeRange, levels: [], services: [], attributes: [], limit: 50, offset: 0 };
const traceInput = {
  fromTs: "2026-10-21 10:00:00",
  toTs: "2026-10-21 11:00:00",
  namespace: [],
  service: [],
  name: "",
  status: "all" as const,
  attributes: [],
  limit: 50,
};
const errorInput = {
  fromTs: traceInput.fromTs,
  toTs: traceInput.toTs,
  q: "",
  service: [],
  fingerprint: "",
  sort: "lastSeen" as const,
  limit: 50,
  offset: 0,
  attributes: [],
};

const traceSummary = {
  traceId: "trace",
  rootName: "GET /",
  rootService: "api",
  rootNamespace: "",
  rootStatus: "Ok",
  rootStatusCode: "200",
  startTs: "2026-10-21 10:00:00.123456789",
  durationNs: "18446744073709551615",
  spanCount: "2",
  errorCount: "0",
  services: ["api"],
};
const span = {
  traceId: "trace",
  spanId: "span",
  parentSpanId: "",
  spanName: "GET /",
  serviceName: "api",
  serviceNamespace: "",
  timestamp: traceSummary.startTs,
  timestampNs: "1792576800123456789",
  duration: traceSummary.durationNs,
  statusCode: "Ok",
  spanKind: "Server",
  spanAttributes: { nested: { array: [true, null, "safe"] } },
  resourceAttributes: null,
  eventNames: ["event"],
  eventTimestamps: [traceSummary.startTs],
  eventAttributes: [null],
  linkTraceIds: [],
  linkSpanIds: [],
  linkAttributes: [],
};

const errorSummary = {
  fingerprint: "fp",
  exceptionType: "Error",
  exceptionMessage: "test",
  body: "test",
  latestServiceName: "api",
  services: ["api"],
  occurrenceCount: "2",
  traceCount: "1",
  firstSeen: traceSummary.startTs,
  lastSeen: traceSummary.startTs,
  latestTraceId: "trace",
  latestSpanId: "span",
  latestTimestamp: traceSummary.startTs,
};

describe("repository result validation", () => {
  it("treats empty legacy span statuses as Unset", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ ...traceSummary, rootStatus: "" }])
      .mockResolvedValueOnce([{ ...span, statusCode: "" }]);
    const repo = new TracesRepository({ execute });
    expect((await repo.search(traceInput))[0].rootStatus).toBe("Unset");
    expect((await repo.getTrace({ traceId: "trace" }))[0].statusCode).toBe("Unset");
  });

  it("preserves trace precision and normalizes quoted counts", async () => {
    const repo = new TracesRepository({ execute: vi.fn().mockResolvedValue([traceSummary]) });
    expect(await repo.search(traceInput)).toEqual([
      { ...traceSummary, spanCount: 2, errorCount: 0 },
    ]);
  });

  it("preserves span nanoseconds, events and nested nullable attributes", async () => {
    const repo = new TracesRepository({ execute: vi.fn().mockResolvedValue([span]) });
    const [result] = await repo.getTrace({ traceId: "trace" });
    expect(result.timestampNs).toBe(span.timestampNs);
    expect(result.duration).toBe(span.duration);
    expect(result.timestamp).toBe(span.timestamp);
    expect(result.events).toEqual([
      { name: "event", timestamp: traceSummary.startTs, attributes: {} },
    ]);
    expect(result.spanAttributes).toEqual({ "nested.array": '[true,null,"safe"]' });
    expect(result.resourceAttributes).toEqual({});
  });

  it.each([
    { ...traceSummary, startTs: "not-a-date" },
    { ...traceSummary, spanCount: "NaN" },
    { ...traceSummary, rootStatus: "unknown" },
  ])("rejects malformed trace summaries: %j", async (row) => {
    const repo = new TracesRepository({ execute: vi.fn().mockResolvedValue([row]) });
    await expect(repo.search(traceInput)).rejects.toThrow("Invalid SQL query response");
  });

  it.each([
    { ...span, duration: "NaN" },
    { ...span, timestampNs: "1.5" },
    { ...span, eventTimestamps: ["invalid"] },
    { ...span, spanAttributes: [] },
  ])("rejects malformed trace detail columns: %j", async (row) => {
    const repo = new TracesRepository({ execute: vi.fn().mockResolvedValue([row]) });
    await expect(repo.getTrace({ traceId: "trace" })).rejects.toThrow("Invalid SQL query response");
  });

  it("rejects invalid log levels before mapping an explorer row", async () => {
    const row = {
      timestampRaw: traceSummary.startTs,
      level: "invalid",
      body: null,
      traceId: "",
      spanId: "",
      serviceName: "api",
      bodyHash: "18446744073709551615",
    };
    const repo = new LogsRepository({ execute: vi.fn().mockResolvedValue([row]) });
    await expect(repo.explorer(logsInput)).rejects.toThrow("Invalid SQL query response");
  });

  it("rejects malformed totals and histogram timestamps", async () => {
    const counts = { error: "0", warning: "0", info: "2", debug: "0", trace: "0", unknown: "0" };
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ ...counts, info: "" }])
      .mockResolvedValueOnce([{ ...counts, total: "2", bucket: "invalid" }]);
    const repo = new LogsRepository({ execute });
    await expect(repo.totals(logsInput)).rejects.toThrow("Invalid SQL query response");
    await expect(repo.histogram({ ...logsInput, histogramBuckets: 12 })).rejects.toThrow(
      "Invalid SQL query response",
    );
  });

  it("rejects malformed error counts before mapping an issue", async () => {
    const repo = new ErrorsRepository({
      execute: vi.fn().mockResolvedValue([{ ...errorSummary, occurrenceCount: "bad" }]),
    });
    await expect(repo.searchIssues(errorInput)).rejects.toThrow("Invalid SQL query response");
  });

  it("validates error occurrences independently from their summary", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([errorSummary])
      .mockResolvedValueOnce([{ timestamp: "invalid" }]);
    const repo = new ErrorsRepository({ execute });
    await expect(
      repo.getIssue({
        fingerprint: "fp",
        fromTs: traceInput.fromTs,
        toTs: traceInput.toTs,
        service: [],
        occurrenceLimit: 50,
      }),
    ).rejects.toThrow("Invalid SQL query response");
  });

  it("rejects malformed attribute discovery columns", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ key: "host.name", source: "unknown" }])
      .mockResolvedValueOnce([{ v: null }]);
    const repo = new LogsRepository({ execute });
    await expect(repo.attributeKeys({ timeRange })).rejects.toThrow("Invalid SQL query response");
    await expect(
      repo.attributeValues({ timeRange, source: "log", key: "host.name" }),
    ).rejects.toThrow("Invalid SQL query response");
  });
});
