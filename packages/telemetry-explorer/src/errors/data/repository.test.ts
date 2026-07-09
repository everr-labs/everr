import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorsRepository } from "./repository";

const execute = vi.fn();
const client = { execute };

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([]);
});

function makeRepo(tableName?: string) {
  return new ErrorsRepository(client, tableName ? { tableName } : undefined);
}

describe("ErrorsRepository.searchIssues", () => {
  it("groups exception logs by fingerprint with paging and a stable order", async () => {
    execute.mockResolvedValueOnce([
      {
        fingerprint: "fp-1",
        exceptionType: "TypeError",
        exceptionMessage: "boom",
        body: "boom",
        latestServiceName: "web",
        services: ["web"],
        occurrenceCount: "3",
        traceCount: "2",
        firstSeen: "2026-05-26 10:00:00.000000000",
        lastSeen: "2026-05-26 10:05:00.000000000",
        latestTraceId: "trace-1",
        latestSpanId: "span-1",
        latestTimestamp: "2026-05-26 10:05:00.000000000",
      },
    ]);

    const result = await makeRepo().searchIssues({
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      q: "boom",
      service: ["web"],
      fingerprint: "",
      sort: "lastSeen",
      limit: 50,
      offset: 50,
      attributes: [],
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("FROM logs");
    expect(sql).toContain("SeverityNumber >= 17");
    expect(sql).toContain("GROUP BY fingerprint");
    expect(sql).toContain(
      "ORDER BY lastSeen DESC, occurrenceCount DESC, fingerprint DESC",
    );
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(sql).toContain("OFFSET {offset:UInt32}");
    expect(params).toMatchObject({ q: "boom", limit: 50, offset: 50 });
    expect(result.issues[0]).toMatchObject({
      fingerprint: "fp-1",
      occurrenceCount: 3,
      traceCount: 2,
    });
  });

  it("orders by occurrence count when requested", async () => {
    await makeRepo().searchIssues({
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      q: "",
      service: [],
      fingerprint: "fp-1",
      sort: "count",
      limit: 25,
      offset: 0,
      attributes: [],
    });
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(sql).toContain(
      "ORDER BY occurrenceCount DESC, lastSeen DESC, fingerprint DESC",
    );
  });

  it("queries the configured table name", async () => {
    await makeRepo("otel_logs").searchIssues({
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      q: "",
      service: [],
      fingerprint: "",
      sort: "lastSeen",
      limit: 50,
      offset: 0,
      attributes: [],
    });
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("FROM otel_logs");
    expect(sql).not.toContain("FROM logs");
  });

  it("rejects invalid table names", async () => {
    await expect(
      makeRepo("logs; DROP TABLE x; --").searchIssues({
        fromTs: "2026-05-26 10:00:00",
        toTs: "2026-05-26 11:00:00",
        q: "",
        service: [],
        fingerprint: "",
        sort: "lastSeen",
        limit: 50,
        offset: 0,
        attributes: [],
      }),
    ).rejects.toThrow("invalid table name");
  });
});

describe("ErrorsRepository.getIssue", () => {
  it("runs a summary then an occurrences query and returns the detail", async () => {
    execute
      .mockResolvedValueOnce([
        {
          fingerprint: "fp-1",
          exceptionType: "TypeError",
          exceptionMessage: "boom",
          body: "boom",
          latestServiceName: "web",
          services: ["web"],
          occurrenceCount: "3",
          traceCount: "2",
          firstSeen: "2026-05-26 10:00:00.000000000",
          lastSeen: "2026-05-26 10:05:00.000000000",
          latestTraceId: "trace-1",
          latestSpanId: "span-1",
          latestTimestamp: "2026-05-26 10:05:00.000000000",
        },
      ])
      .mockResolvedValueOnce([
        {
          fingerprint: "fp-1",
          timestamp: "2026-05-26 10:05:00.000000000",
          serviceName: "web",
          traceId: "trace-1",
          spanId: "span-1",
          body: "boom",
          exceptionType: "TypeError",
          exceptionMessage: "boom",
          exceptionStacktrace: "at x",
          resourceAttributes: null,
          logAttributes: null,
          scopeAttributes: null,
        },
      ]);

    const detail = await makeRepo().getIssue({
      fingerprint: "fp-1",
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      service: [],
      occurrenceLimit: 50,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(detail.summary.fingerprint).toBe("fp-1");
    expect(detail.latest.resourceAttributes).toEqual({});
    expect(detail.occurrences).toHaveLength(1);
  });
});

describe("ErrorsRepository.listTriageEvents", () => {
  it("reads triage events for a fingerprint, oldest first", async () => {
    execute.mockResolvedValueOnce([
      {
        timestamp: "2026-07-01 10:00:00.000000000",
        eventType: "investigation",
        body: "## Findings\nNull deref in retry path.",
        logAttributes: {
          "everr.error.event": "investigation",
          "everr.error.fingerprint": "fp-1",
          "everr.error.author.id": "user-1",
          "everr.error.author.name": "Ada Lovelace",
        },
      },
    ]);

    const events = await makeRepo().listTriageEvents({
      fingerprint: "fp-1",
      limit: 500,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("FROM logs");
    expect(sql).toContain(
      "LogAttributes['everr.error.fingerprint'] = {fingerprint:String}",
    );
    expect(sql).toContain(
      "LogAttributes['everr.error.event'] IN {eventTypes:Array(String)}",
    );
    expect(sql).toContain("ORDER BY Timestamp ASC");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(params).toMatchObject({
      fingerprint: "fp-1",
      limit: 500,
      eventTypes: ["investigation", "resolved", "ignored", "reopened"],
    });
    expect(events).toEqual([
      {
        type: "investigation",
        timestamp: "2026-07-01 10:00:00.000000000",
        body: "## Findings\nNull deref in retry path.",
        author: { id: "user-1", name: "Ada Lovelace" },
      },
    ]);
  });

  it("drops rows with unknown event types and tolerates null attributes", async () => {
    execute.mockResolvedValueOnce([
      {
        timestamp: "2026-07-01 10:00:00.000000000",
        eventType: "acknowledged",
        body: "future event",
        logAttributes: {},
      },
      {
        timestamp: "2026-07-01 11:00:00.000000000",
        eventType: "resolved",
        body: "Fixed by #42.",
        logAttributes: null,
      },
    ]);

    const events = await makeRepo().listTriageEvents({
      fingerprint: "fp-1",
      limit: 500,
    });

    expect(events).toEqual([
      {
        type: "resolved",
        timestamp: "2026-07-01 11:00:00.000000000",
        body: "Fixed by #42.",
        author: { id: "", name: "" },
      },
    ]);
  });

  it("queries the configured table name and rejects invalid ones", async () => {
    await makeRepo("otel_logs").listTriageEvents({
      fingerprint: "fp-1",
      limit: 500,
    });
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("FROM otel_logs");

    await expect(
      makeRepo("logs; DROP TABLE x; --").listTriageEvents({
        fingerprint: "fp-1",
        limit: 500,
      }),
    ).rejects.toThrow("invalid table name");
  });
});

describe("ErrorsRepository.listServices", () => {
  it("returns distinct service names", async () => {
    execute.mockResolvedValueOnce([
      { serviceName: "web" },
      { serviceName: "" },
      { serviceName: "api" },
    ]);
    const services = await makeRepo().listServices({
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      attributes: [],
    });
    expect(services).toEqual(["web", "api"]);
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("SELECT DISTINCT ServiceName");
  });
});

describe("ErrorsRepository attribute discovery", () => {
  it("scopes attributeKeys to exception logs", async () => {
    await makeRepo().attributeKeys({
      timeRange: { from: "now-1h", to: "now" },
    });
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("SeverityNumber >= 17");
  });

  it("scopes attributeValues to exception logs", async () => {
    await makeRepo().attributeValues({
      timeRange: { from: "now-1h", to: "now" },
      source: "log",
      key: "exception.type",
    });
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("SeverityNumber >= 17");
  });
});
