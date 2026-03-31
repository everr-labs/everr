import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { query } from "@/lib/clickhouse";
import { getGrepMatches } from "./grep";

const mockedQuery = vi.mocked(query);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getGrepMatches", () => {
  it("builds failing-step grep queries with literal case-insensitive matching", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          branch: "release/1.2",
          occurrence_count: "2",
          last_seen: "2026-03-07 11:00:00",
        },
      ])
      .mockResolvedValueOnce([
        {
          branch: "release/1.2",
          trace_id: "trace-2",
          run_id: "run-2",
          run_attempt: "3",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "5",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "4200",
          timestamp: "2026-03-07 11:00:00",
          match_count: "4",
          matched_line: "Expect X to be Y",
        },
      ]);

    const result = await getGrepMatches({
      data: {
        repo: "everr-labs/everr",
        pattern: "Expect X to be Y",
        jobName: "integration",
        stepNumber: "5",
        excludeBranch: "feature/current-issue",
        limit: 20,
        offset: 7,
        timeRange: {
          from: "now-30d",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "lowerUTF8(t.StatusMessage) IN ('failure', 'failed')",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "positionCaseInsensitive(l.Body, {pattern:String}) > 0",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "t.ResourceAttributes['cicd.pipeline.task.name'] = {jobName:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "t.SpanAttributes['everr.github.workflow_job_step.number'] = {stepNumber:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "t.ResourceAttributes['vcs.ref.head.name'] != {excludeBranch:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "LIMIT {limit:UInt32} OFFSET {offset:UInt32}",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        repo: "everr-labs/everr",
        pattern: "Expect X to be Y",
        jobName: "integration",
        stepNumber: "5",
        excludeBranch: "feature/current-issue",
        limit: 20,
        offset: 7,
      }),
    );
    expect(mockedQuery.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        branches: ["release/1.2"],
        occurrenceLimit: 5,
        lineLimit: 3,
      }),
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "t.StatusMessage as step_conclusion",
    );
    expect(mockedQuery.mock.calls[1]?.[0]).toContain("as run_conclusion");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "t.Duration / 1000000 as step_duration",
    );
    const occurrenceSummaryGroupBy = mockedQuery.mock.calls[1]?.[0]
      .split("FROM matching_lines")[1]
      ?.split("),\n    ranked_occurrences")[0];
    expect(occurrenceSummaryGroupBy).toBeDefined();
    expect(occurrenceSummaryGroupBy).not.toContain("step_conclusion");
    expect(occurrenceSummaryGroupBy).not.toContain("run_conclusion");
    expect(occurrenceSummaryGroupBy).not.toContain("step_duration");
    expect(result).toEqual({
      repo: "everr-labs/everr",
      pattern: "Expect X to be Y",
      jobName: "integration",
      stepNumber: "5",
      branch: null,
      excludedBranch: "feature/current-issue",
      timeRange: {
        from: "now-30d",
        to: "now",
      },
      limit: 20,
      items: [
        {
          branch: "release/1.2",
          occurrenceCount: 2,
          lastSeen: "2026-03-07 11:00:00",
          recentOccurrences: [
            {
              traceId: "trace-2",
              runId: "run-2",
              runAttempt: 3,
              workflowName: "CI",
              jobName: "integration",
              stepNumber: "5",
              stepName: "Test",
              stepConclusion: "failure",
              runConclusion: "failure",
              stepDuration: 4200,
              timestamp: "2026-03-07 11:00:00",
              matchCount: 4,
              matchedLines: ["Expect X to be Y"],
            },
          ],
        },
      ],
    });
  });

  it("uses an explicit branch filter without excludeBranch", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          branch: "release/1.2",
          occurrence_count: "1",
          last_seen: "2026-03-07 11:00:00",
        },
      ])
      .mockResolvedValueOnce([]);

    await getGrepMatches({
      data: {
        repo: "everr-labs/everr",
        pattern: "panic",
        branch: "release/1.2",
        limit: 5,
        offset: 0,
        timeRange: {
          from: "now-7d",
          to: "now",
        },
      },
    });

    expect(mockedQuery.mock.calls[0]?.[0]).toContain(
      "t.ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[0]).not.toContain(
      "!= {excludeBranch:String}",
    );
    expect(mockedQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        repo: "everr-labs/everr",
        pattern: "panic",
        branch: "release/1.2",
        limit: 5,
        offset: 0,
      }),
    );
  });

  it("groups detail rows by branch, sorts recent occurrences, and truncates lines", async () => {
    mockedQuery
      .mockResolvedValueOnce([
        {
          branch: "release/1.2",
          occurrence_count: "6",
          last_seen: "2026-03-07 11:00:00",
        },
      ])
      .mockResolvedValueOnce([
        {
          branch: "release/1.2",
          trace_id: "trace-5",
          run_id: "run-5",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "5",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "5000",
          timestamp: "2026-03-07 11:00:00",
          match_count: "4",
          matched_line: "line-1",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-5",
          run_id: "run-5",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "5",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "5000",
          timestamp: "2026-03-07 11:00:00",
          match_count: "4",
          matched_line: "line-2",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-5",
          run_id: "run-5",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "5",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "5000",
          timestamp: "2026-03-07 11:00:00",
          match_count: "4",
          matched_line: "line-3",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-5",
          run_id: "run-5",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "5",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "5000",
          timestamp: "2026-03-07 11:00:00",
          match_count: "4",
          matched_line: "line-4",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-4",
          run_id: "run-4",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "4",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "4000",
          timestamp: "2026-03-07 10:00:00",
          match_count: "1",
          matched_line: "older-1",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-3",
          run_id: "run-3",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "3",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "3000",
          timestamp: "2026-03-07 09:00:00",
          match_count: "1",
          matched_line: "older-2",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-2",
          run_id: "run-2",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "2",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "2000",
          timestamp: "2026-03-07 08:00:00",
          match_count: "1",
          matched_line: "older-3",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-1",
          run_id: "run-1",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "1",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "1000",
          timestamp: "2026-03-07 07:00:00",
          match_count: "1",
          matched_line: "older-4",
        },
        {
          branch: "release/1.2",
          trace_id: "trace-0",
          run_id: "run-0",
          run_attempt: "1",
          workflow_name: "CI",
          job_name: "integration",
          step_number: "0",
          step_name: "Test",
          step_conclusion: "failure",
          run_conclusion: "failure",
          step_duration: "0",
          timestamp: "2026-03-07 06:00:00",
          match_count: "1",
          matched_line: "older-5",
        },
      ]);

    const result = await getGrepMatches({
      data: {
        repo: "everr-labs/everr",
        pattern: "panic",
        limit: 20,
        offset: 0,
        timeRange: {
          from: "now-30d",
          to: "now",
        },
      },
    });

    expect(result.items[0]?.recentOccurrences).toHaveLength(5);
    expect(result.items[0]?.recentOccurrences[0]?.traceId).toBe("trace-5");
    expect(result.items[0]?.recentOccurrences[0]?.stepConclusion).toBe(
      "failure",
    );
    expect(result.items[0]?.recentOccurrences[0]?.runConclusion).toBe(
      "failure",
    );
    expect(result.items[0]?.recentOccurrences[0]?.stepDuration).toBe(5000);
    expect(result.items[0]?.recentOccurrences[0]?.matchedLines).toEqual([
      "line-1",
      "line-2",
      "line-3",
    ]);
  });

  it("returns early when no matching branches are found", async () => {
    mockedQuery.mockResolvedValueOnce([]);

    const result = await getGrepMatches({
      data: {
        repo: "everr-labs/everr",
        pattern: "panic",
        limit: 20,
        offset: 0,
        timeRange: {
          from: "now-30d",
          to: "now",
        },
      },
    });

    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([]);
  });

  it("rejects time ranges wider than the maximum grep lookback", async () => {
    await expect(
      getGrepMatches({
        data: {
          repo: "everr-labs/everr",
          pattern: "panic",
          limit: 20,
          offset: 0,
          timeRange: {
            from: "now-31d",
            to: "now",
          },
        },
      }),
    ).rejects.toThrow("maximum lookback of 30 days");

    expect(mockedQuery).not.toHaveBeenCalled();
  });
});
