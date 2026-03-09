import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  })),
}));

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getWaitPipelineStatus } from "./wait-pipeline";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getWaitPipelineStatus", () => {
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

    const result = await getWaitPipelineStatus({
      data: {
        repo: "everr-labs/everr",
        branch: "feature/wait-short-commit",
        commit: "7f14b13",
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "AND startsWith(sha, {commit:String})",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/wait-short-commit",
      commit: "7f14b13",
    });
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "AND event_kind = 'pipelinerun'",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "toUInt64(round(avg(duration_seconds))) as usualDurationSeconds",
    );
    expect(mockedQuery.mock.calls[1]?.[1]).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/wait-short-commit",
      commit: "7f14b13",
    });
    expect(result).toEqual({
      repo: "everr-labs/everr",
      branch: "feature/wait-short-commit",
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
