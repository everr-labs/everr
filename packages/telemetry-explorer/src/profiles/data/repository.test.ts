import { describe, expect, it, vi } from "vite-plus/test";
import { ProfilesRepository } from "./repository";
import { buildProfileWhere } from "./where";

const timeRange = { from: "2026-01-01T00:00:00.000Z", to: "2026-01-01T01:00:00.000Z" };

function repoReturning(rows: unknown[]) {
  const execute = vi.fn().mockResolvedValue(rows);
  return { repo: new ProfilesRepository({ execute }), execute };
}

describe("buildProfileWhere", () => {
  it("reads every service when none is selected", () => {
    const { clause, params } = buildProfileWhere({ timeRange, attributes: [] });
    expect(clause).not.toContain("ServiceName");
    expect(params).not.toHaveProperty("services");
  });

  it("binds the services, trace, function search and attributes as parameters", () => {
    const { clause, params } = buildProfileWhere({
      timeRange,
      services: ["api", "worker"],
      traceId: "abc",
      q: " Encode ",
      attributes: [
        { source: "resource", key: "host.name", op: "in", values: ["a"] },
        { source: "sample", key: "thread.name", op: "missing", values: [] },
      ],
    });
    expect(clause).toContain("ServiceName IN {services:Array(String)}");
    expect(clause).toContain("positionCaseInsensitive(f, {q:String})");
    expect(clause).toContain("ResourceAttributes[{attrKey0:String}] IN {attrVals0:Array(String)}");
    expect(clause).toContain("NOT mapContains(SampleAttributes, {attrKey1:String})");
    expect(params).toMatchObject({
      services: ["api", "worker"],
      traceId: "abc",
      q: "Encode",
      attrKey0: "host.name",
      attrVals0: ["a"],
      attrKey1: "thread.name",
    });
  });

  it("narrows to service versions only when some are given", () => {
    const { clause, params } = buildProfileWhere({
      timeRange,
      versions: ["1.2.0"],
      attributes: [],
    });
    expect(clause).toContain("ResourceAttributes['service.version'] IN {versions:Array(String)}");
    expect(params).toMatchObject({ versions: ["1.2.0"] });
    expect(buildProfileWhere({ timeRange, versions: [], attributes: [] }).clause).not.toContain(
      "service.version",
    );
  });

  it("skips a value filter that has no values yet", () => {
    const { clause } = buildProfileWhere({
      timeRange,
      attributes: [{ source: "resource", key: "host.name", op: "in", values: [] }],
    });
    expect(clause).not.toContain("host.name");
    expect(clause).not.toContain("mapContains");
  });
});

describe("ProfilesRepository", () => {
  it("returns root-first stacks with the totals before the limit", async () => {
    const { repo } = repoReturning([
      {
        functionNames: ["leaf", "main"],
        fileNames: ["", ""],
        lineNumbers: [0, 0],
        mappingFileNames: ["", ""],
        addresses: ["", ""],
        value: "6",
        totalValue: "10",
        stackCount: "3",
      },
    ]);
    const result = await repo.stacks({ timeRange, sampleType: "cpu", sampleUnit: "nanoseconds" });
    expect(result.stacks[0]?.frames.map((f) => f.name)).toEqual(["main", "leaf"]);
    expect(result).toMatchObject({ totalValue: 10, stackCount: 3 });
  });

  it("sends each code revision once, with the stacks pointing at it", async () => {
    const row = (name: string, repository: string, revision: string) => ({
      functionNames: [name],
      fileNames: [""],
      lineNumbers: [0],
      mappingFileNames: [""],
      addresses: [""],
      repository,
      revision,
      value: "1",
      totalValue: "3",
      stackCount: "3",
    });
    const { repo } = repoReturning([
      row("a", "https://github.com/acme/api", "abc"),
      row("b", "https://github.com/acme/api", "abc"),
      row("c", "", ""),
    ]);
    const result = await repo.stacks({ timeRange, sampleType: "cpu", sampleUnit: "nanoseconds" });
    expect(result.sources).toEqual([
      { repository: "https://github.com/acme/api", revision: "abc" },
    ]);
    expect(result.stacks.map((stack) => stack.source)).toEqual([0, 0, undefined]);
  });

  it("lists versions with UTC first and last seen times", async () => {
    const { repo } = repoReturning([
      {
        version: "1.2.0",
        firstSeen: "2026-01-01 00:01:00.000000000",
        lastSeen: "2026-01-01 00:59:30.123456789",
      },
    ]);
    expect(await repo.listVersions({ timeRange, attributes: [] })).toEqual([
      {
        version: "1.2.0",
        firstSeen: "2026-01-01T00:01:00.000Z",
        lastSeen: "2026-01-01T00:59:30.123Z",
      },
    ]);
  });

  it("finds example traces among the samples that ran the function", async () => {
    const { repo, execute } = repoReturning([
      { traceId: "t1", spanId: "s1", serviceName: "api", rootSpanName: "GET /", value: "7" },
    ]);
    const traces = await repo.exampleTraces({
      timeRange,
      sampleType: "cpu",
      sampleUnit: "nanoseconds",
      functionName: "encode",
    });
    expect(traces).toEqual([
      { traceId: "t1", spanId: "s1", serviceName: "api", rootSpanName: "GET /", value: 7 },
    ]);
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ functionName: "encode", limit: 20 });
  });

  it("returns a histogram bucket for every interval of the range, empty ones at zero", async () => {
    const { repo } = repoReturning([{ bucket: "2026-01-01 00:00:00", value: "42" }]);
    const buckets = await repo.histogram({
      timeRange,
      sampleType: "cpu",
      sampleUnit: "nanoseconds",
      buckets: 4,
    });
    expect(buckets.length).toBeGreaterThan(1);
    expect(buckets[0]).toMatchObject({ timestamp: "2026-01-01T00:00:00.000Z", value: 42 });
    expect(buckets.slice(1).every((bucket) => bucket.value === 0)).toBe(true);
  });

  it("reads a span's timestamped samples as root-first stacks, marking a full page truncated", async () => {
    const { repo, execute } = repoReturning([
      {
        functionNames: ["hash", "main"],
        fileNames: ["", ""],
        lineNumbers: [0, 0],
        mappingFileNames: ["", ""],
        addresses: ["", ""],
        value: "2",
        timestampsNs: ["1794352829290250064", "1794352829300250064"],
        periodNs: "11446000",
      },
    ]);
    const timeline = await repo.spanTimeline({
      timeRange,
      traceId: "trace",
      spanId: "span",
      sampleType: "cpu",
      sampleUnit: "nanoseconds",
      limit: 2,
    });
    expect(timeline.stacks[0]?.frames.map((f) => f.name)).toEqual(["main", "hash"]);
    expect(timeline.stacks[0]?.timestampsNs).toEqual([
      "1794352829290250064",
      "1794352829300250064",
    ]);
    expect(timeline).toMatchObject({ periodNs: 11_446_000, truncated: true });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ traceId: "trace", spanId: "span" });
  });

  it("rejects an unsafe table name", () => {
    expect(
      () => new ProfilesRepository({ execute: vi.fn() }, { tableName: "profiles; DROP" }),
    ).toThrow("invalid table name");
  });
});
