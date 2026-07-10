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

function makeTriageRepo() {
  return new ErrorsRepository(client, { triageEvents: true });
}

const baseSearchInput = {
  fromTs: "2026-05-26 10:00:00",
  toTs: "2026-05-26 11:00:00",
  q: "",
  service: [],
  fingerprint: "",
  sort: "lastSeen" as const,
  status: [],
  limit: 50,
  offset: 0,
  attributes: [],
};

function makeSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function makeOccurrenceRow() {
  return {
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
  };
}

describe("ErrorsRepository.searchIssues", () => {
  it("groups exception logs by fingerprint with paging and a stable order", async () => {
    execute.mockResolvedValueOnce([makeSummaryRow()]);

    const result = await makeRepo().searchIssues({
      ...baseSearchInput,
      q: "boom",
      service: ["web"],
      offset: 50,
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
      ...baseSearchInput,
      fingerprint: "fp-1",
      sort: "count",
      limit: 25,
    });
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(sql).toContain(
      "ORDER BY occurrenceCount DESC, lastSeen DESC, fingerprint DESC",
    );
  });

  it("queries the configured table name", async () => {
    await makeRepo("otel_logs").searchIssues(baseSearchInput);
    const [sql] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("FROM otel_logs");
    expect(sql).not.toContain("FROM logs");
  });

  it("rejects invalid table names", async () => {
    await expect(
      makeRepo("logs; DROP TABLE x; --").searchIssues(baseSearchInput),
    ).rejects.toThrow("invalid table name");
  });

  it("never touches the triage table without the triageEvents option", async () => {
    // Surfaces without a triage table (local/desktop) must emit the same SQL
    // as before triage existed, even when a status filter sneaks in.
    await makeRepo().searchIssues({ ...baseSearchInput, status: ["resolved"] });
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).not.toContain("error_triage_events");
    expect(sql).not.toContain("status");
    expect(sql).not.toContain("regressed");
    expect(params).not.toHaveProperty("statusFilter");
  });
});

describe("ErrorsRepository.searchIssues with triage events", () => {
  const resolvedStatusRow = {
    fingerprint: "fp-1",
    lastStatusType: "resolved",
    lastStatusAt: "2026-05-26 09:00:00.000",
    resolvedVersions: ["1.4.2"],
  };

  it("reads triage state from the events table, then derives in one scan", async () => {
    execute
      .mockResolvedValueOnce([resolvedStatusRow])
      .mockResolvedValueOnce([
        makeSummaryRow({ status: "resolved", regressed: 0 }),
      ]);

    const result = await makeTriageRepo().searchIssues(baseSearchInput);

    expect(execute).toHaveBeenCalledTimes(2);
    // First query: the latest surviving status event per fingerprint, from
    // the events table alone. Entries resolve to their latest version first
    // (edits and deletes are version appends), then the latest event wins.
    const [statusesSql] = execute.mock.calls[0] ?? [];
    expect(statusesSql).toContain("FROM error_triage_events");
    expect(statusesSql).toContain(
      "WHERE event_type IN ('resolved', 'ignored', 'reopened')",
    );
    expect(statusesSql).toContain("GROUP BY event_id");
    expect(statusesSql).toContain("HAVING entryDeleted = 0");
    expect(statusesSql).toContain(
      "argMax(entryType, entryTime) AS lastStatusType",
    );
    expect(statusesSql).toContain(
      "argMax(entryVersions, entryTime) AS resolvedVersions",
    );

    // Second query: the single logs scan takes the triage state as Map
    // params. Derivation: ignored is sticky; a resolved Error reopens only
    // on a Regression; everything else is open.
    const [sql, params] = execute.mock.calls[1] ?? [];
    expect(sql).not.toContain("error_triage_events");
    expect(sql).not.toContain("JOIN");
    expect(sql).toContain(
      "{statusByFp:Map(String, String)}[fingerprint] = 'ignored', 'ignored'",
    );
    expect(sql).toContain("regressed = 1, 'open'");
    expect(sql).toContain(
      "{statusByFp:Map(String, String)}[fingerprint] = 'resolved', 'resolved'",
    );
    expect(sql).toContain(
      "ORDER BY lastSeen DESC, occurrenceCount DESC, fingerprint DESC",
    );
    expect(params).toMatchObject({
      statusByFp: { "fp-1": "resolved" },
      resolvedAtByFp: { "fp-1": "2026-05-26 09:00:00.000" },
      resolvedVersionsByFp: { "fp-1": ["1.4.2"] },
    });

    expect(result.issues[0]).toMatchObject({
      fingerprint: "fp-1",
      status: "resolved",
      regressed: false,
    });
  });

  it("reopens a resolved Error only on a genuine Regression", async () => {
    execute
      .mockResolvedValueOnce([resolvedStatusRow])
      .mockResolvedValueOnce([
        makeSummaryRow({ status: "open", regressed: 1 }),
      ]);

    const result = await makeTriageRepo().searchIssues(baseSearchInput);

    const [sql] = execute.mock.calls[1] ?? [];
    // An Occurrence regresses iff its version is outside the Resolution's
    // resolve-time snapshot; a versionless Occurrence, or a Resolution with
    // no version knowledge, degrades to a plain timestamp comparison.
    expect(sql).toContain(
      "{statusByFp:Map(String, String)}[fingerprint] = 'resolved'",
    );
    expect(sql).toContain("serviceVersion = ''");
    expect(sql).toContain(
      "empty({resolvedVersionsByFp:Map(String, Array(String))}[fingerprint])",
    );
    expect(sql).toContain(
      "Timestamp > {resolvedAtByFp:Map(String, DateTime64(3))}[fingerprint]",
    );
    expect(sql).toContain(
      "NOT has({resolvedVersionsByFp:Map(String, Array(String))}[fingerprint], serviceVersion)",
    );

    expect(result.issues[0]).toMatchObject({
      fingerprint: "fp-1",
      status: "open",
      regressed: true,
    });
  });

  it("filters by derived status when requested", async () => {
    await makeTriageRepo().searchIssues({
      ...baseSearchInput,
      status: ["open", "ignored"],
    });
    const [sql, params] = execute.mock.calls[1] ?? [];
    expect(sql).toContain("HAVING status IN {statusFilter:Array(String)}");
    expect(params).toMatchObject({ statusFilter: ["open", "ignored"] });
  });

  it("applies no status filter when the selection is empty", async () => {
    await makeTriageRepo().searchIssues(baseSearchInput);
    const [sql, params] = execute.mock.calls[1] ?? [];
    expect(sql).not.toContain("statusFilter");
    expect(params).not.toHaveProperty("statusFilter");
    expect(params).toMatchObject({
      statusByFp: {},
      resolvedAtByFp: {},
      resolvedVersionsByFp: {},
    });
  });

  it("prunes both queries by the fingerprint filter", async () => {
    await makeTriageRepo().searchIssues({
      ...baseSearchInput,
      fingerprint: "fp-1",
    });
    const [statusesSql, statusesParams] = execute.mock.calls[0] ?? [];
    expect(statusesSql).toContain("AND fingerprint = {fingerprint:String}");
    expect(statusesParams).toMatchObject({ fingerprint: "fp-1" });
    const [sql, params] = execute.mock.calls[1] ?? [];
    expect(sql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(params).toMatchObject({ fingerprint: "fp-1" });
  });

  it("derives a forward status event type as open instead of breaking", async () => {
    execute
      .mockResolvedValueOnce([
        { ...resolvedStatusRow, lastStatusType: "acknowledged" },
      ])
      .mockResolvedValueOnce([
        makeSummaryRow({ status: "open", regressed: 0 }),
      ]);

    const result = await makeTriageRepo().searchIssues(baseSearchInput);
    // The unknown type never reaches the derivation params.
    const [, params] = execute.mock.calls[1] ?? [];
    expect(params).toMatchObject({ statusByFp: {} });
    expect(result.issues[0]?.status).toBe("open");
  });

  it("drops an unknown forward status value instead of breaking the row", async () => {
    execute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeSummaryRow({ status: "acknowledged", regressed: 1 }),
      ]);

    const result = await makeTriageRepo().searchIssues(baseSearchInput);
    expect(result.issues[0]?.status).toBeUndefined();
    // regressed travels with status: a dropped status drops the flag too.
    expect(result.issues[0]?.regressed).toBeUndefined();
    expect(result.issues[0]?.fingerprint).toBe("fp-1");
  });
});

describe("ErrorsRepository.getIssue", () => {
  it("runs a summary then an occurrences query and returns the detail", async () => {
    execute
      .mockResolvedValueOnce([makeSummaryRow()])
      .mockResolvedValueOnce([makeOccurrenceRow()]);

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

  it("derives the summary status when triage events are enabled", async () => {
    execute
      .mockResolvedValueOnce([
        {
          fingerprint: "fp-1",
          lastStatusType: "ignored",
          lastStatusAt: "2026-05-26 09:00:00.000",
          resolvedVersions: [],
        },
      ])
      .mockResolvedValueOnce([makeSummaryRow({ status: "ignored" })])
      .mockResolvedValueOnce([makeOccurrenceRow()]);

    const detail = await makeTriageRepo().getIssue({
      fingerprint: "fp-1",
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      service: [],
      occurrenceLimit: 50,
    });

    expect(execute).toHaveBeenCalledTimes(3);
    // The detail load prunes the triage scan to the one fingerprint and
    // feeds the summary query its status as params.
    const [statusesSql] = execute.mock.calls[0] ?? [];
    expect(statusesSql).toContain("FROM error_triage_events");
    expect(statusesSql).toContain("AND fingerprint = {fingerprint:String}");
    const [, summaryParams] = execute.mock.calls[1] ?? [];
    expect(summaryParams).toMatchObject({ statusByFp: { "fp-1": "ignored" } });
    expect(detail.summary.status).toBe("ignored");
  });
});

describe("ErrorsRepository.listTriageEvents", () => {
  it("resolves the latest version per entry, oldest entry first", async () => {
    execute.mockResolvedValueOnce([
      {
        eventId: "11111111-2222-3333-4444-555555555555",
        eventType: "investigation",
        latestBody: "## Findings\nNull deref in retry path.",
        authorId: "user-1",
        createdAt: "2026-07-01 10:00:00.000",
        lastUpdatedAt: "2026-07-02 09:00:00.000",
        latestVersion: 2,
        latestDeleted: 0,
      },
    ]);

    const events = await makeRepo().listTriageEvents({
      fingerprint: "fp-1",
      limit: 500,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("FROM error_triage_events");
    expect(sql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(sql).toContain("argMax(body, version) AS latestBody");
    expect(sql).toContain("GROUP BY event_id");
    expect(sql).toContain("HAVING latestDeleted = 0");
    expect(sql).toContain("ORDER BY createdAt ASC");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(params).toEqual({ fingerprint: "fp-1", limit: 500 });
    expect(events).toEqual([
      {
        id: "11111111-2222-3333-4444-555555555555",
        type: "investigation",
        timestamp: "2026-07-01 10:00:00.000",
        updatedAt: "2026-07-02 09:00:00.000",
        edited: true,
        body: "## Findings\nNull deref in retry path.",
        author: { id: "user-1", name: "" },
      },
    ]);
  });

  it("drops rows with unknown forward event types", async () => {
    execute.mockResolvedValueOnce([
      {
        eventId: "aaaa1111-2222-3333-4444-555555555555",
        eventType: "acknowledged",
        latestBody: "future event",
        authorId: "user-1",
        createdAt: "2026-07-01 10:00:00.000",
        lastUpdatedAt: "2026-07-01 10:00:00.000",
        latestVersion: 0,
        latestDeleted: 0,
      },
      {
        eventId: "bbbb1111-2222-3333-4444-555555555555",
        eventType: "resolved",
        latestBody: "Fixed by #42.",
        authorId: "user-2",
        createdAt: "2026-07-01 11:00:00.000",
        lastUpdatedAt: "2026-07-01 11:00:00.000",
        latestVersion: "0",
        latestDeleted: "0",
      },
    ]);

    const events = await makeRepo().listTriageEvents({
      fingerprint: "fp-1",
      limit: 500,
    });

    expect(events).toEqual([
      {
        id: "bbbb1111-2222-3333-4444-555555555555",
        type: "resolved",
        timestamp: "2026-07-01 11:00:00.000",
        updatedAt: "2026-07-01 11:00:00.000",
        edited: false,
        body: "Fixed by #42.",
        author: { id: "user-2", name: "" },
      },
    ]);
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
