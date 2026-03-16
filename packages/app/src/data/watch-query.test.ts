import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getWatchStatus } from "./watch";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWatchStatus", () => {
  it("matches short commit SHA prefixes in the pipeline query", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          subjectId: "88",
          subjectName: "CI",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/88",
          phase: "finished",
          conclusion: "success",
          lastEventTime: "2026-03-06T10:01:00Z",
          eventKind: "pipelinerun",
          pipelineRunId: "",
          durationSeconds: "61",
        },
      ])
      .mockResolvedValueOnce([
        {
          workflow_name: "CI",
          usualDurationSeconds: "57.6",
          sampleCount: "3",
        },
      ]);

    const result = await getWatchStatus({
      data: {
        repo: "everr-labs/everr",
        branch: "feature/watch-short-commit",
        commit: "7f14b13",
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "WHERE event_kind IN ('pipelinerun', 'taskrun', 'workflowjob')",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "AND repository = {repo:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "AND startsWith(sha, {commit:String})",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "argMax(attributes['pipeline.run_id'], event_time) as pipelineRunId",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
    });
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "WHERE event_kind = 'pipelinerun'",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "AND repository = {repo:String}",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "toUInt64(round(avg(duration_seconds))) as usualDurationSeconds",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).not.toContain("row_number() OVER");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "LIMIT 3 BY workflow_name",
    );
    expect(mockedQuery.mock.calls[1]?.[1]).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
    });
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/watch-short-commit",
      commit: "7f14b13",
      pipelineFound: true,
      activeRuns: [],
      completedRuns: [
        {
          runId: "88",
          workflowName: "CI",
          phase: "finished",
          conclusion: "success",
          lastEventTime: "2026-03-06T10:01:00Z",
          durationSeconds: 61,
          usualDurationSeconds: 58,
          usualDurationSampleSize: 3,
          activeJobs: [],
        },
      ],
    });
  });
});
