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
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).not.toContain("error_triage_events");
    expect(sql).not.toContain("status");
    expect(sql).not.toContain("regressed");
    expect(params).not.toHaveProperty("statusFilter");
  });
});

describe("ErrorsRepository.searchIssues with triage events", () => {
  it("derives status from the latest status event, ignored sticky", async () => {
    execute.mockResolvedValueOnce([
      makeSummaryRow({ status: "resolved", regressed: "0" }),
    ]);

    const result = await makeTriageRepo().searchIssues(baseSearchInput);

    const [sql] = execute.mock.calls[0] ?? [];
    // Status events resolve to their latest version first (edits and deletes
    // are version appends), then the latest event per fingerprint wins.
    expect(sql).toContain("FROM error_triage_events");
    expect(sql).toContain(
      "WHERE event_type IN ('resolved', 'ignored', 'reopened')",
    );
    expect(sql).toContain("GROUP BY event_id");
    expect(sql).toContain("HAVING entryDeleted = 0");
    expect(sql).toContain("argMax(entryType, entryTime) AS lastStatusType");
    // Derivation: ignored is sticky; a resolved Error reopens only on a
    // Regression; everything else is open.
    expect(sql).toContain("lastStatusType = 'ignored', 'ignored'");
    expect(sql).toContain("regressed = 1, 'open'");
    expect(sql).toContain("lastStatusType = 'resolved', 'resolved'");
    expect(sql).toContain("LEFT ANY JOIN");
    expect(sql).toContain(
      "ORDER BY lastSeen DESC, occurrenceCount DESC, fingerprint DESC",
    );

    expect(result.issues[0]).toMatchObject({
      fingerprint: "fp-1",
      status: "resolved",
      regressed: false,
    });
  });

  it("reopens a resolved Error only on a version-aware Regression", async () => {
    execute.mockResolvedValueOnce([
      makeSummaryRow({ status: "open", regressed: "1" }),
    ]);

    const result = await makeTriageRepo().searchIssues(baseSearchInput);

    const [sql] = execute.mock.calls[0] ?? [];
    // Version order is first-seen time in telemetry, per service, unbounded
    // by the queried range: an Occurrence reopens iff its version was first
    // seen after the Resolution, and a versionless Occurrence degrades to a
    // plain timestamp comparison.
    expect(sql).toContain(
      "ResourceAttributes['service.version'] AS occVersion",
    );
    expect(sql).toContain("min(Timestamp) AS versionFirstSeenAt");
    expect(sql).toContain("ON occService = versionService");
    expect(sql).toContain(
      "max(if(occVersion = '', occLastSeenAt, versionFirstSeenAt) > occResolvedAt) AS regressed",
    );
    // Only resolved Errors feed the rule, so nothing scans when none could
    // regress, and only rule reopens carry the Regressed flag.
    expect(sql).toContain("WHERE lastStatusType = 'resolved'");

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
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("status IN {statusFilter:Array(String)}");
    expect(params).toMatchObject({ statusFilter: ["open", "ignored"] });
  });

  it("applies no status filter when the selection is empty", async () => {
    await makeTriageRepo().searchIssues(baseSearchInput);
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).not.toContain("statusFilter");
    expect(params).not.toHaveProperty("statusFilter");
  });

  it("keeps the fingerprint filter working alongside the triage join", async () => {
    await makeTriageRepo().searchIssues({
      ...baseSearchInput,
      fingerprint: "fp-1",
    });
    const [sql, params] = execute.mock.calls[0] ?? [];
    expect(sql).toContain("WHERE fingerprint = {fingerprint:String}");
    expect(params).toMatchObject({ fingerprint: "fp-1" });
  });

  it("drops an unknown forward status value instead of breaking the row", async () => {
    execute.mockResolvedValueOnce([
      makeSummaryRow({ status: "acknowledged", regressed: "1" }),
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
      .mockResolvedValueOnce([makeSummaryRow({ status: "ignored" })])
      .mockResolvedValueOnce([makeOccurrenceRow()]);

    const detail = await makeTriageRepo().getIssue({
      fingerprint: "fp-1",
      fromTs: "2026-05-26 10:00:00",
      toTs: "2026-05-26 11:00:00",
      service: [],
      occurrenceLimit: 50,
    });

    const [summarySql] = execute.mock.calls[0] ?? [];
    expect(summarySql).toContain("FROM error_triage_events");
    // The detail load prunes the triage scan to the one fingerprint.
    expect(summarySql).toContain("AND fingerprint = {fingerprint:String}");
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
