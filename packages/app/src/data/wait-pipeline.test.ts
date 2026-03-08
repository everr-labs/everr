import { describe, expect, it } from "vitest";
import { buildWaitPipelineStatus } from "./wait-pipeline-status";

describe("buildWaitPipelineStatus", () => {
  it("maps active taskrun jobs onto their pipeline run", () => {
    const result = buildWaitPipelineStatus(
      {
        repo: "everr-labs/everr",
        branch: "main",
        commit: "abc123",
      },
      [
        {
          subjectId: "42",
          subjectName: "CI",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42",
          phase: "started",
          conclusion: "",
          lastEventTime: "2026-03-06T10:00:00Z",
          eventKind: "pipelinerun",
          pipelineRunId: "",
          durationSeconds: "125",
        },
        {
          subjectId: "job-1",
          subjectName: "test",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42/job/1",
          phase: "started",
          conclusion: "",
          lastEventTime: "2026-03-06T10:00:01Z",
          eventKind: "taskrun",
          pipelineRunId: "42",
          durationSeconds: "120",
        },
        {
          subjectId: "job-2",
          subjectName: "lint",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42/job/2",
          phase: "finished",
          conclusion: "success",
          lastEventTime: "2026-03-06T10:00:10Z",
          eventKind: "taskrun",
          pipelineRunId: "42",
          durationSeconds: "10",
        },
      ],
    );

    expect(result.pipelineFound).toBe(true);
    expect(result.activeRuns).toHaveLength(1);
    expect(result.activeRuns[0]?.activeJobs).toEqual(["test"]);
  });
});
