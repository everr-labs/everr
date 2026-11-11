import { describe, expect, it, vi } from "vite-plus/test";
import { RuntimeMetricsRepository } from "./runtime";

const timeRange = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T00:04:00.000Z" };

function repoReturning(delayRows: unknown[], gcRows: unknown[]) {
  const execute = vi.fn();
  execute.mockImplementation((sql: string) =>
    Promise.resolve(sql.includes("v8js.gc.duration") ? gcRows : delayRows),
  );
  return { repo: new RuntimeMetricsRepository({ execute }), execute };
}

describe("RuntimeMetricsRepository", () => {
  it("returns every bucket of the range, with no delay where nothing was reported", async () => {
    const { repo } = repoReturning(
      [{ bucket: "2026-01-01 00:01:00", p99: 0.012, max: "0.05" }],
      [],
    );
    const result = await repo.runtime({ timeRange, buckets: 4 });

    expect(result.buckets.map((bucket) => bucket.timestamp)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:01:00.000Z",
      "2026-01-01T00:02:00.000Z",
      "2026-01-01T00:03:00.000Z",
      "2026-01-01T00:04:00.000Z",
    ]);
    expect(result.buckets[1]).toMatchObject({ eventLoopDelayP99: 0.012, eventLoopDelayMax: 0.05 });
    expect(result.buckets[0]).toMatchObject({ eventLoopDelayP99: null, eventLoopDelayMax: null });
    expect(result).toMatchObject({ hasEventLoopDelay: true, hasGc: false });
  });

  it("splits GC time by type, counting a type semconv does not name as major", async () => {
    const { repo } = repoReturning(
      [],
      [
        { bucket: "2026-01-01 00:02:00", gcType: "minor", seconds: "0.004" },
        { bucket: "2026-01-01 00:02:00", gcType: "major", seconds: 0.02 },
        { bucket: "2026-01-01 00:02:00", gcType: "", seconds: 0.01 },
      ],
    );
    const result = await repo.runtime({ timeRange, buckets: 4 });

    expect(result.buckets[2]?.gc).toEqual({ minor: 0.004, major: 0.03, incremental: 0, weakcb: 0 });
    expect(result.buckets[0]?.gc).toEqual({ minor: 0, major: 0, incremental: 0, weakcb: 0 });
    expect(result).toMatchObject({ hasEventLoopDelay: false, hasGc: true });
  });

  it("narrows both metrics by service and resource attributes only", async () => {
    const { repo, execute } = repoReturning([], []);
    await repo.runtime({
      timeRange,
      services: ["api"],
      attributes: [
        { source: "resource", key: "deployment.environment", op: "in", values: ["prod"] },
      ],
    });

    for (const [sql, params] of execute.mock.calls as unknown as [string, object][]) {
      expect(sql).toContain("ServiceName IN {services:Array(String)}");
      expect(sql).toContain("ResourceAttributes[{attrKey0:String}] IN {attrVals0:Array(String)}");
      expect(params).toMatchObject({
        services: ["api"],
        attrKey0: "deployment.environment",
        attrVals0: ["prod"],
      });
    }
  });
});
