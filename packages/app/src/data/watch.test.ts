import { describe, expect, it } from "vitest";
import { buildWatchStatus } from "./watch-status";

describe("buildWatchStatus", () => {
  it("maps active taskrun jobs onto their pipeline run", () => {
    const result = buildWatchStatus(
      {
        repo: "everr-labs/everr",
        branch: "main",
        commit: "abc123",
      },
      [
        {
          subjectId: "42",
          runAttempt: 1,
          subjectName: "CI",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42",
          status: "in_progress",
          conclusion: null,
          lastEventTime: "2026-03-06T10:00:00Z",
          eventKind: "pipelinerun",
          pipelineRunId: "",
          durationSeconds: "125",
        },
        {
          subjectId: "job-1",
          runAttempt: 1,
          subjectName: "test",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42/job/1",
          status: "in_progress",
          conclusion: null,
          lastEventTime: "2026-03-06T10:00:01Z",
          eventKind: "taskrun",
          pipelineRunId: "42",
          durationSeconds: "120",
        },
        {
          subjectId: "job-2",
          runAttempt: 1,
          subjectName: "lint",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42/job/2",
          status: "completed",
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
    expect(result.activeRuns[0]?.runAttempt).toBe(1);
    expect(result.activeRuns[0]?.activeJobs).toEqual(["test"]);
    expect(result.activeRuns[0]?.usualDurationSeconds).toBeNull();
    expect(result.activeRuns[0]?.usualDurationSampleSize).toBe(0);
  });

  it("attaches a duration baseline when historical runs exist", () => {
    const result = buildWatchStatus(
      {
        repo: "everr-labs/everr",
        branch: "main",
        commit: "abc123",
      },
      [
        {
          subjectId: "42",
          runAttempt: 1,
          subjectName: "CI",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42",
          status: "in_progress",
          conclusion: null,
          lastEventTime: "2026-03-06T10:00:00Z",
          eventKind: "pipelinerun",
          pipelineRunId: "",
          durationSeconds: "125",
        },
      ],
      new Map([
        [
          "CI",
          {
            durationSeconds: 119,
            sampleSize: 3,
          },
        ],
      ]),
    );

    expect(result.pipelineFound).toBe(true);
    expect(result.activeRuns[0]).toMatchObject({
      runAttempt: 1,
      usualDurationSeconds: 119,
      usualDurationSampleSize: 3,
    });
  });

  it("keeps jobs separated by run attempt", () => {
    const result = buildWatchStatus(
      {
        repo: "everr-labs/everr",
        branch: "main",
        commit: "abc123",
      },
      [
        {
          subjectId: "42",
          runAttempt: 1,
          subjectName: "CI",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42",
          status: "completed",
          conclusion: "success",
          lastEventTime: "2026-03-06T10:00:00Z",
          eventKind: "pipelinerun",
          pipelineRunId: "",
          durationSeconds: "60",
        },
        {
          subjectId: "42",
          runAttempt: 2,
          subjectName: "CI",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42",
          status: "in_progress",
          conclusion: null,
          lastEventTime: "2026-03-06T10:05:00Z",
          eventKind: "pipelinerun",
          pipelineRunId: "",
          durationSeconds: "30",
        },
        {
          subjectId: "job-1",
          runAttempt: 1,
          subjectName: "old-test",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42/job/1",
          status: "in_progress",
          conclusion: null,
          lastEventTime: "2026-03-06T10:00:30Z",
          eventKind: "taskrun",
          pipelineRunId: "42",
          durationSeconds: "30",
        },
        {
          subjectId: "job-2",
          runAttempt: 2,
          subjectName: "new-test",
          htmlUrl: "https://github.com/everr-labs/everr/actions/runs/42/job/2",
          status: "in_progress",
          conclusion: null,
          lastEventTime: "2026-03-06T10:05:10Z",
          eventKind: "taskrun",
          pipelineRunId: "42",
          durationSeconds: "10",
        },
      ],
    );

    expect(result.activeRuns).toEqual([
      expect.objectContaining({
        runId: "42",
        runAttempt: 2,
        activeJobs: ["new-test"],
      }),
    ]);
    expect(result.completedRuns).toEqual([
      expect.objectContaining({
        runId: "42",
        runAttempt: 1,
        activeJobs: ["old-test"],
      }),
    ]);
  });
});
