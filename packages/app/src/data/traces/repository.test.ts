import { beforeEach, describe, expect, it, vi } from "vitest";
import { TracesRepository } from "./repository";
import type { ServiceIdentity, TraceSummary } from "./types";

const query = vi.fn();

beforeEach(() => {
  query.mockReset();
});

function makeRepo() {
  return new TracesRepository(query);
}

describe("TracesRepository.search", () => {
  it("returns rows from ClickHouse and forwards the time window + paging", async () => {
    const row: TraceSummary = {
      traceId: "t1",
      rootName: "GET /home",
      rootService: "web",
      rootNamespace: "",
      rootStatus: "Ok",
      startTs: "2026-05-20 12:00:00.000",
      durationNs: "1500000",
      spanCount: 3,
      errorCount: 0,
      services: ["web"],
    };
    query.mockResolvedValueOnce([row]);

    const result = await makeRepo().search({
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
      namespace: [],
      service: [],
      name: "",
      status: "all",
      limit: 25,
    });

    expect(result).toEqual([row]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("FROM app.traces");
    expect(sql).toContain("Timestamp BETWEEN {fromTs:DateTime64(9)}");
    expect(params).toMatchObject({
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
      limit: 25,
    });
  });

  it("adds HAVING clauses for duration + status filters and skips empty ones", async () => {
    query.mockResolvedValueOnce([]);

    await makeRepo().search({
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
      namespace: [],
      service: [],
      name: "",
      minDurationNs: "1000",
      status: "error",
      limit: 50,
    });

    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("HAVING");
    expect(sql).toContain("durationNsRaw >= {minDurationNs:UInt64}");
    expect(sql).not.toContain("durationNsRaw <= {maxDurationNs:UInt64}");
    expect(sql).toContain("rootStatus = {status:String}");
    expect(params).toMatchObject({ minDurationNs: "1000", status: "Error" });
  });

  it("propagates query errors", async () => {
    query.mockRejectedValueOnce(new Error("clickhouse exploded"));

    await expect(
      makeRepo().search({
        fromTs: "2026-05-20 11:00:00.000",
        toTs: "2026-05-20 13:00:00.000",
        namespace: [],
        service: [],
        name: "",
        status: "all",
        limit: 25,
      }),
    ).rejects.toThrow("clickhouse exploded");
  });
});

describe("TracesRepository.getTrace", () => {
  it("maps events and links from parallel arrays into structured spans", async () => {
    query.mockResolvedValueOnce([
      {
        traceId: "t1",
        spanId: "s1",
        parentSpanId: "",
        spanName: "root",
        serviceName: "web",
        serviceNamespace: "app",
        timestamp: "2026-05-20 12:00:00.000",
        timestampNs: "1000",
        duration: "500",
        statusCode: "Ok",
        spanKind: "Server",
        spanAttributes: { "http.method": "GET" },
        resourceAttributes: { "service.namespace": "app" },
        eventNames: ["dns.lookup", "tls.handshake"],
        eventTimestamps: ["1010", "1020"],
        eventAttributes: [{ host: "example.com" }, { protocol: "tls1.3" }],
        linkTraceIds: ["linked-trace"],
        linkSpanIds: ["linked-span"],
        linkAttributes: [{ relation: "follows_from" }],
      },
    ]);

    const result = await makeRepo().getTrace({
      traceId: "t1",
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE TraceId = {traceId:String}");
    expect(sql).toContain("Timestamp BETWEEN {fromTs:DateTime64(9)}");
    expect(params).toEqual({
      traceId: "t1",
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.events).toEqual([
      {
        name: "dns.lookup",
        timestamp: "1010",
        attributes: { host: "example.com" },
      },
      {
        name: "tls.handshake",
        timestamp: "1020",
        attributes: { protocol: "tls1.3" },
      },
    ]);
    expect(result[0]?.links).toEqual([
      {
        traceId: "linked-trace",
        spanId: "linked-span",
        attributes: { relation: "follows_from" },
      },
    ]);
  });

  it("propagates query errors", async () => {
    query.mockRejectedValueOnce(new Error("not found"));
    await expect(
      makeRepo().getTrace({
        traceId: "missing",
        fromTs: "2026-05-20 11:00:00.000",
        toTs: "2026-05-20 13:00:00.000",
      }),
    ).rejects.toThrow("not found");
  });
});

describe("TracesRepository.listServiceIdentities", () => {
  it("returns distinct (namespace, name) pairs from the time window", async () => {
    const rows: ServiceIdentity[] = [
      { serviceNamespace: "app", serviceName: "api" },
      { serviceNamespace: "github", serviceName: "actions" },
    ];
    query.mockResolvedValueOnce(rows);

    const result = await makeRepo().listServiceIdentities({
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
    });

    expect(result).toEqual(rows);
    const [sql, params] = query.mock.calls[0] ?? [];
    expect(sql).toContain("SELECT DISTINCT");
    expect(sql).toContain("ResourceAttributes['service.namespace']");
    expect(params).toEqual({
      fromTs: "2026-05-20 11:00:00.000",
      toTs: "2026-05-20 13:00:00.000",
    });
  });

  it("propagates query errors", async () => {
    query.mockRejectedValueOnce(new Error("permission denied"));
    await expect(
      makeRepo().listServiceIdentities({
        fromTs: "2026-05-20 11:00:00.000",
        toTs: "2026-05-20 13:00:00.000",
      }),
    ).rejects.toThrow("permission denied");
  });
});
