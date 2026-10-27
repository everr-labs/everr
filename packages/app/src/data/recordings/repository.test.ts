import { describe, expect, it } from "vite-plus/test";
import { RecordingsRepository, type SqlClient } from "./repository";

const summary = {
  clipId: "1710000000000-1000000000001",
  streamId: "stream-1",
  sessionId: "session-1",
  serviceName: "web",
  startedAt: "2026-03-09 12:00:00.000000000",
  endedAt: "2026-03-09 12:00:10.000000000",
  url: "https://app.example/checkout",
  route: "/checkout",
  segmentCount: 2,
};

function client(handler: (sql: string) => unknown[] | Promise<unknown[]>) {
  const calls: { sql: string; params: Record<string, unknown> }[] = [];
  const sql: SqlClient = {
    execute: async <T>(statement: string, params: Record<string, unknown> = {}) => {
      calls.push({ sql: statement, params });
      // The fixture picks the row shape from the SQL text. The repository
      // already types each call.
      return (await handler(statement)) as T[];
    },
  };
  return { calls, repo: new RecordingsRepository(sql) };
}

describe("RecordingsRepository", () => {
  it("lists one row per Clip, newest first, without a tenant predicate", async () => {
    const { calls, repo } = client(async (sql) => {
      if (sql.includes("FROM recordings")) return [summary];
      if (sql.includes("FROM traces")) return [{ clipId: summary.clipId, trigger: "error" }];
      return [];
    });

    const clips = await repo.list({
      fromTs: "2026-03-09 11:00:00.000",
      toTs: "2026-03-09 13:00:00.000",
      service: ["web"],
      environment: [],
      limit: 50,
      offset: 0,
    });

    expect(clips).toEqual([{ ...summary, trigger: "error" }]);
    const listSql = calls[0]?.sql ?? "";
    expect(listSql).toContain("FROM recordings");
    expect(listSql).toContain("GROUP BY clip_id");
    expect(listSql).toContain("ORDER BY max(Timestamp) DESC, clip_id ASC");
    expect(listSql).toContain("ServiceName IN {services:Array(String)}");
    expect(listSql).not.toContain("tenant_id");
    expect(listSql).not.toContain("SQL_everr_tenant_id");
    expect(calls[0]?.params).toMatchObject({ services: ["web"], limit: 50, offset: 0 });
    const triggerSql = calls[1]?.sql ?? "";
    expect(triggerSql).toContain("SpanName = 'recording'");
    expect(triggerSql).toContain("IN {clipIds:Array(String)}");
    expect(triggerSql).not.toContain("JOIN");
    expect(calls[1]?.params).toMatchObject({ clipIds: [summary.clipId], services: ["web"] });
  });

  it("skips the trigger lookup when the page has no Clips", async () => {
    const { calls, repo } = client(async () => []);

    await repo.list({
      fromTs: "2026-03-09 11:00:00.000",
      toTs: "2026-03-09 13:00:00.000",
      service: [],
      environment: ["prod"],
      limit: 50,
      offset: 0,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain(
      "ResourceAttributes.`deployment.environment.name`) IN {environments:Array(String)}",
    );
    expect(calls[0]?.sql).not.toContain("ServiceName IN");
    expect(calls[0]?.params).toMatchObject({ environments: ["prod"] });
    expect(calls[0]?.params).not.toHaveProperty("services");
  });

  it("loads Segments for one Clip by service, session, and clip id", async () => {
    const { calls, repo } = client(async (sql) => {
      if (sql.includes("segmentIndex")) {
        return [{ segmentIndex: 0, body: '[{"type":2,"timestamp":1}]' }];
      }
      if (sql.includes("FROM traces")) return [{ clipId: summary.clipId, trigger: "network" }];
      if (sql.includes("clip_id = {clipId:String}")) return [summary];
      return [];
    });

    const detail = await repo.get({
      clipId: summary.clipId,
      fromTs: "2026-03-09 11:00:00.000",
      toTs: "2026-03-09 13:00:00.000",
      service: [],
      environment: [],
    });

    expect(detail).toMatchObject({
      clipId: summary.clipId,
      trigger: "network",
      segments: [{ index: 0, body: '[{"type":2,"timestamp":1}]' }],
    });
    const segmentSql = calls.find((call) => call.sql.includes("segmentIndex"))?.sql ?? "";
    expect(segmentSql).toContain("ServiceName = {service:String}");
    expect(segmentSql).toContain("session_id = {sessionId:String}");
    expect(segmentSql).toContain("clip_id = {clipId:String}");
    expect(segmentSql).toContain("INTERVAL 7 MINUTE");
    expect(segmentSql).not.toContain("tenant_id");
    const segmentParams = calls.find((call) => call.sql.includes("segmentIndex"))?.params;
    expect(segmentParams).toMatchObject({
      service: "web",
      sessionId: "session-1",
      clipId: summary.clipId,
      fromTs: summary.startedAt,
      toTs: summary.endedAt,
    });
  });

  it("returns null when the Clip is outside the window", async () => {
    const { calls, repo } = client(async () => []);
    const detail = await repo.get({
      clipId: summary.clipId,
      fromTs: "2026-03-09 11:00:00.000",
      toTs: "2026-03-09 13:00:00.000",
      service: [],
      environment: [],
    });
    expect(detail).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
