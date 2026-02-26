import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { getRunsList } from "@/data/runs-list";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

interface ResolvedBranchContext {
  repo?: string;
  branch?: string;
  repoSource?: string;
  branchSource?: string;
  gitRoot?: string;
}

function normalizeBranchName(rawBranch: string | undefined): string | undefined {
  if (!rawBranch) {
    return undefined;
  }
  if (rawBranch.startsWith("refs/heads/")) {
    return rawBranch.slice("refs/heads/".length);
  }
  return rawBranch;
}

function parseRepoFromRemoteUrl(remoteUrl: string | undefined): string | undefined {
  if (!remoteUrl) {
    return undefined;
  }

  const trimmed = remoteUrl.trim();
  const sshMatch = trimmed.match(/^[^@]+@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    return sshMatch[1];
  }

  const urlMatch = trimmed.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (urlMatch) {
    return urlMatch[1];
  }

  return undefined;
}

function runGit(args: string[], cwd: string): string | undefined {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output.length === 0) {
      return undefined;
    }
    return output;
  } catch {
    return undefined;
  }
}

function resolveBranchContextFromLocalGit(input: {
  repo?: string;
  branch?: string;
  cwd?: string;
}): ResolvedBranchContext {
  if (input.repo && input.branch) {
    return {
      repo: input.repo,
      branch: input.branch,
      repoSource: "input.repo",
      branchSource: "input.branch",
    };
  }

  const cwd = input.cwd ?? process.cwd();
  const gitRoot = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!gitRoot) {
    return {
      repo: input.repo,
      branch: input.branch,
      repoSource: input.repo ? "input.repo" : undefined,
      branchSource: input.branch ? "input.branch" : undefined,
    };
  }

  const headBranch = normalizeBranchName(
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot),
  );
  const originUrl = runGit(["config", "--get", "remote.origin.url"], gitRoot);
  const repoFromGit = parseRepoFromRemoteUrl(originUrl);

  const repo = input.repo ?? repoFromGit;
  const branch = input.branch ?? headBranch;

  return {
    repo,
    branch,
    repoSource: input.repo ? "input.repo" : "git:remote.origin.url",
    branchSource: input.branch ? "input.branch" : "git:HEAD",
    gitRoot,
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function resolveInputTimeRange(args: { from?: string; to?: string }) {
  return {
    from: args.from ?? DEFAULT_TIME_RANGE.from,
    to: args.to ?? DEFAULT_TIME_RANGE.to,
  };
}

export function registerBranchStatusTools(server: McpServer) {
  server.registerTool(
    "prepare_ci_status",
    {
      description:
        "Prepare CI status context by resolving repository and branch from the local Git repository. Use before ci_status.",
      inputSchema: {
        cwd: z
          .string()
          .optional()
          .describe(
            "Optional local working directory where Git commands should run. Defaults to current process directory.",
          ),
      },
    },
    async (args) => {
      const resolved = resolveBranchContextFromLocalGit(args);
      const missing: string[] = [];
      if (!resolved.repo) {
        missing.push("repo");
      }
      if (!resolved.branch) {
        missing.push("branch");
      }

      const payload = {
        ok: missing.length === 0,
        repo: resolved.repo ?? null,
        branch: resolved.branch ?? null,
        sources: {
          repo: resolved.repoSource ?? null,
          branch: resolved.branchSource ?? null,
        },
        gitRoot: resolved.gitRoot ?? null,
        missing,
        message:
          missing.length === 0
            ? "Branch status context is ready."
            : "Could not resolve repository/branch from local Git. Ensure this runs inside a git repo with a valid origin remote.",
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        ...(missing.length > 0 ? { isError: true } : {}),
      };
    },
  );

  server.registerTool(
    "ci_status",
    {
      description:
        "Analyze recent CI runs for a branch: report failing pipelines, detect slowdown versus recent and older runs on main, or confirm healthy status with the latest pipeline duration.",
      inputSchema: {
        repo: z
          .string()
          .optional()
          .describe(
            "Repository (e.g. 'owner/repo'). Optional if prepare_ci_status already resolved it from local Git.",
          ),
        branch: z
          .string()
          .optional()
          .describe(
            "Branch name. Optional if prepare_ci_status already resolved it from local Git.",
          ),
        cwd: z
          .string()
          .optional()
          .describe(
            "Optional local working directory to resolve git branch/repo when repo/branch are not provided.",
          ),
        mainBranch: z
          .string()
          .optional()
          .describe("Mainline branch used for comparison. Defaults to 'main'."),
        from: z
          .string()
          .optional()
          .describe(
            "Start of time range (e.g. 'now-7d'). Defaults to 'now-7d'.",
          ),
        to: z
          .string()
          .optional()
          .describe("End of time range. Defaults to 'now'."),
        recentRuns: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            "How many recent branch runs to inspect. Defaults to 10 (and uses the same size for main baselines).",
          ),
        slowdownThresholdPct: z
          .number()
          .min(1)
          .max(500)
          .optional()
          .describe(
            "Report slowdown when latest duration exceeds main baselines by at least this percentage. Defaults to 20.",
          ),
      },
    },
    async (args) => {
      const resolved = resolveBranchContextFromLocalGit(args);
      if (!resolved.repo || !resolved.branch) {
        const missing: string[] = [];
        if (!resolved.repo) {
          missing.push("repo");
        }
        if (!resolved.branch) {
          missing.push("branch");
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Missing required context: ${missing.join(", ")}. Run prepare_ci_status from your local git checkout or pass repo/branch.`,
              }),
            },
          ],
          isError: true,
        };
      }

      const timeRange = resolveInputTimeRange(args);
      const recentRuns = args.recentRuns ?? 10;
      const mainBranch = args.mainBranch ?? "main";
      const slowdownThresholdPct = args.slowdownThresholdPct ?? 20;

      const [branchRunsResult, mainRecentResult, mainOlderResult] =
        await Promise.all([
          getRunsList({
            data: {
              timeRange,
              page: 1,
              pageSize: recentRuns,
              repo: resolved.repo,
              branch: resolved.branch,
            },
          }),
          getRunsList({
            data: {
              timeRange,
              page: 1,
              pageSize: recentRuns,
              repo: resolved.repo,
              branch: mainBranch,
              conclusion: "success",
            },
          }),
          getRunsList({
            data: {
              timeRange,
              page: 2,
              pageSize: recentRuns,
              repo: resolved.repo,
              branch: mainBranch,
              conclusion: "success",
            },
          }),
        ]);

      const branchRuns = branchRunsResult.runs;
      if (branchRuns.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "no_data",
                repo: resolved.repo,
                branch: resolved.branch,
                message: "No branch runs found for the selected time range.",
              }),
            },
          ],
        };
      }

      const latestRun = branchRuns[0];
      const failingPipelines = branchRuns
        .filter((run) => run.conclusion === "failure")
        .map((run) => ({
          traceId: run.traceId,
          runId: run.runId,
          workflowName: run.workflowName,
          conclusion: run.conclusion,
          duration: run.duration,
          timestamp: run.timestamp,
        }));

      const mainRecentDurations = mainRecentResult.runs.map((run) => run.duration);
      const mainOlderDurations = mainOlderResult.runs.map((run) => run.duration);

      const mainRecentAvg = average(mainRecentDurations);
      const mainOlderAvg = average(mainOlderDurations);

      const slowdownVsRecentPct =
        mainRecentAvg && mainRecentAvg > 0
          ? ((latestRun.duration - mainRecentAvg) / mainRecentAvg) * 100
          : null;
      const slowdownVsOlderPct =
        mainOlderAvg && mainOlderAvg > 0
          ? ((latestRun.duration - mainOlderAvg) / mainOlderAvg) * 100
          : null;

      const isSlowComparedToRecent =
        slowdownVsRecentPct !== null &&
        slowdownVsRecentPct >= slowdownThresholdPct;
      const isSlowComparedToOlder =
        slowdownVsOlderPct !== null && slowdownVsOlderPct >= slowdownThresholdPct;

      const slowdownDetected = isSlowComparedToRecent || isSlowComparedToOlder;
      const status =
        failingPipelines.length > 0 || slowdownDetected ? "attention" : "ok";

      const payload = {
        status,
        repo: resolved.repo,
        branch: resolved.branch,
        mainBranch,
        inspectedRuns: {
          branch: branchRuns.length,
          mainRecent: mainRecentResult.runs.length,
          mainOlder: mainOlderResult.runs.length,
        },
        latestPipeline: {
          traceId: latestRun.traceId,
          runId: latestRun.runId,
          workflowName: latestRun.workflowName,
          conclusion: latestRun.conclusion,
          duration: latestRun.duration,
          timestamp: latestRun.timestamp,
        },
        failingPipelines,
        slowdown: {
          detected: slowdownDetected,
          thresholdPct: slowdownThresholdPct,
          latestDuration: latestRun.duration,
          mainRecentAvgDuration: mainRecentAvg,
          mainOlderAvgDuration: mainOlderAvg,
          slowdownVsRecentPct,
          slowdownVsOlderPct,
        },
        message:
          failingPipelines.length > 0
            ? `Found ${failingPipelines.length} failing pipeline(s) in recent branch runs.`
            : slowdownDetected
              ? "No recent branch failures, but latest pipeline duration is slower than main baselines."
              : `Everything looks good. Latest pipeline duration is ${latestRun.duration.toFixed(2)} seconds.`,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
      };
    },
  );
}
