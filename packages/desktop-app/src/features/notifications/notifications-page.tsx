import { Button } from "@everr/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Clipboard, ExternalLink, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { invokeCommand, SEEN_RUNS_CHANGED_EVENT } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import { formatNotificationRelativeTime } from "../../notification-time";

type RunListItem = {
  traceId: string;
  runId: string;
  runAttempt: number;
  workflowName: string;
  repo: string;
  branch: string;
  conclusion: string;
  duration: number;
  timestamp: string;
  sender: string;
};

const runsListQueryKey = ["desktop-app", "runs-list"] as const;
const unseenTraceIdsQueryKey = ["desktop-app", "unseen-trace-ids"] as const;

function getRunsList() {
  return invokeCommand<RunListItem[]>("get_runs_list");
}

function getUnseenTraceIds() {
  return invokeCommand<string[]>("get_unseen_trace_ids");
}

function markAllRunsSeen() {
  return invokeCommand<void>("mark_all_runs_seen");
}

export function NotificationsPage() {
  useInvalidateOnTauriEvent(SEEN_RUNS_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: unseenTraceIdsQueryKey });
  });

  const runsQuery = useQuery({
    queryKey: runsListQueryKey,
    queryFn: getRunsList,
    refetchOnWindowFocus: true,
  });

  const unseenQuery = useQuery({
    queryKey: unseenTraceIdsQueryKey,
    queryFn: getUnseenTraceIds,
    refetchOnWindowFocus: true,
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllRunsSeen,
  });

  const runs = runsQuery.data ?? [];
  const unseenSet = new Set(unseenQuery.data ?? []);
  const hasUnread = unseenSet.size > 0;

  return (
    <div className="pt-8">
      <div className="flex items-start justify-between gap-4 px-5 pb-4">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Runs
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Recent CI pipeline runs.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasUnread && (
            <Button
              variant="outline"
              size="sm"
              disabled={markAllReadMutation.isPending}
              onClick={() => void markAllReadMutation.mutateAsync()}
            >
              Mark all as read
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={runsQuery.isFetching}
            onClick={() => void runsQuery.refetch()}
          >
            <RefreshCw
              className={`size-3.5 ${runsQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {runsQuery.isPending ? (
        <div className="px-5 py-4">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Loading runs...
          </p>
        </div>
      ) : runs.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            No runs yet. CI pipeline runs will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.78rem]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[0.7rem] font-medium uppercase tracking-wider text-[var(--settings-text-muted)]">
                <th className="w-8 py-2 pl-5 pr-1 font-medium" />
                <th className="py-2 px-2 font-medium">Workflow</th>
                <th className="py-2 px-2 font-medium">Repository</th>
                <th className="py-2 px-2 font-medium">Branch</th>
                <th className="py-2 px-2 font-medium">Result</th>
                <th className="py-2 px-2 font-medium">When</th>
                <th className="w-16 py-2 pl-2 pr-5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow
                  key={run.traceId}
                  run={run}
                  unseen={unseenSet.has(run.traceId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function conclusionBadgeClass(conclusion: string): string {
  switch (conclusion) {
    case "success":
      return "bg-emerald-500/15 text-emerald-400";
    case "failure":
      return "bg-red-500/15 text-red-400";
    case "cancellation":
      return "bg-yellow-500/15 text-yellow-400";
    default:
      return "bg-white/[0.06] text-[var(--settings-text-muted)]";
  }
}

function RunRow({ run, unseen }: { run: RunListItem; unseen: boolean }) {
  const relativeTime = formatNotificationRelativeTime(run.timestamp);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copyMutation = useMutation({
    mutationFn: () =>
      invokeCommand<void>("copy_run_auto_fix_prompt", { traceId: run.traceId }),
    onSuccess() {
      clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    },
  });

  const openMutation = useMutation({
    mutationFn: () =>
      invokeCommand<void>("open_run_in_browser", { traceId: run.traceId }),
  });

  const markSeenMutation = useMutation({
    mutationFn: () =>
      invokeCommand<void>("mark_run_seen", { traceId: run.traceId }),
  });

  return (
    <tr
      className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]"
      onMouseEnter={() => {
        if (unseen) void markSeenMutation.mutateAsync();
      }}
    >
      <td className="py-2 pl-5 pr-1">
        {unseen ? (
          <span className="block size-2 rounded-full bg-red-500" />
        ) : (
          <span className="block size-2" />
        )}
      </td>
      <td className="py-2 px-2 font-medium text-[var(--settings-text)]">
        {run.workflowName}
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)]">
        {run.repo}
      </td>
      <td className="py-2 px-2">
        <span className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.72rem] text-[var(--settings-text-muted)]">
          {run.branch}
        </span>
      </td>
      <td className="py-2 px-2">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[0.72rem] font-medium capitalize ${conclusionBadgeClass(run.conclusion)}`}
        >
          {run.conclusion}
        </span>
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)]">
        {relativeTime}
      </td>
      <td className="py-2 pl-2 pr-5">
        <TooltipProvider>
          <div className="flex items-center gap-1">
            {run.conclusion === "failure" && (
              <Tooltip>
                <TooltipTrigger
                  className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
                  disabled={copyMutation.isPending}
                  onClick={() => void copyMutation.mutateAsync()}
                >
                  <span className="relative grid size-3.5 place-items-center">
                    <Clipboard
                      className={`col-start-1 row-start-1 size-3.5 transition-all duration-200 ${copied ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}
                    />
                    <Check
                      className={`col-start-1 row-start-1 size-3.5 text-emerald-400 transition-all duration-200 ${copied ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {copied ? "Copied!" : "Copy auto-fix prompt"}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger
                className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
                disabled={openMutation.isPending}
                onClick={() => void openMutation.mutateAsync()}
              >
                <ExternalLink className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">Open in browser</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </td>
    </tr>
  );
}
