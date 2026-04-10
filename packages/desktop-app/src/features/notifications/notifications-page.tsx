import { resolve } from "@everr/datemath";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import {
  type TimeRange,
  TimeRangePicker,
} from "@everr/ui/components/time-range-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Check, Clipboard, Workflow } from "lucide-react";
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

function resolveToISO(expr: string, roundUp: boolean): string {
  return resolve(expr, { roundUp }).toISOString();
}

function getRunsList(timeRange: TimeRange) {
  return invokeCommand<RunListItem[]>("get_runs_list", {
    from: resolveToISO(timeRange.from, false),
    to: resolveToISO(timeRange.to, true),
  });
}

function getUnseenTraceIds() {
  return invokeCommand<string[]>("get_unseen_trace_ids");
}

function markAllRunsSeen() {
  return invokeCommand<void>("mark_all_runs_seen");
}

export function NotificationsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>({
    from: "now-1h",
    to: "now",
  });
  const [refreshInterval, setRefreshInterval] = useState("");
  const queryClient = useQueryClient();
  const isFetching = useIsFetching();

  const refetchIntervalMs = getRefreshIntervalMs(refreshInterval) ?? undefined;

  useInvalidateOnTauriEvent(SEEN_RUNS_CHANGED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: unseenTraceIdsQueryKey });
  });

  const runsQuery = useQuery({
    queryKey: [...runsListQueryKey, timeRange.from, timeRange.to],
    queryFn: () => getRunsList(timeRange),
    refetchOnWindowFocus: true,
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: false,
  });

  const unseenQuery = useQuery({
    queryKey: unseenTraceIdsQueryKey,
    queryFn: getUnseenTraceIds,
    refetchOnWindowFocus: true,
    refetchInterval: refetchIntervalMs,
    refetchIntervalInBackground: false,
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
              size="lg"
              disabled={markAllReadMutation.isPending}
              onClick={() => void markAllReadMutation.mutateAsync()}
            >
              Mark all as read
            </Button>
          )}
          <TimeRangePicker value={timeRange} onChange={setTimeRange} />
          <RefreshPicker
            value={refreshInterval}
            onChange={setRefreshInterval}
            onRefresh={() => void queryClient.invalidateQueries()}
            isFetching={isFetching > 0}
          />
        </div>
      </div>

      {runsQuery.isPending ? (
        <div className="px-5 py-4">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Loading runs...
          </p>
        </div>
      ) : runs.length === 0 ? (
        <div className="px-5 py-12">
          <Empty className="border-none">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Workflow />
              </EmptyMedia>
              <EmptyTitle>No runs found</EmptyTitle>
              <EmptyDescription>
                No CI pipeline runs match the selected time range. Try expanding
                the range or check back later.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.78rem] table-fixed">
            <thead>
              <tr className="border-b border-white/[0.06] text-[0.7rem] font-medium uppercase tracking-wider text-[var(--settings-text-muted)]">
                <th className="w-8 py-2 pl-5 pr-1 font-medium" />
                <th className="py-2 px-2 font-medium">Workflow</th>
                <th className="py-2 px-2 font-medium">Repository</th>
                <th className="py-2 px-2 font-medium">Branch</th>
                <th className="py-2 px-2 font-medium">Result</th>
                <th className="py-2 px-2 font-medium">When</th>
                <th className="w-10 py-2 pl-2 pr-5 font-medium" />
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
      <td className="py-2 px-2 font-medium truncate">
        <button
          type="button"
          className="cursor-pointer truncate max-w-full text-left text-[var(--settings-text)] hover:underline disabled:opacity-50 disabled:no-underline"
          disabled={openMutation.isPending}
          onClick={() => void openMutation.mutateAsync()}
        >
          {run.workflowName}
        </button>
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)] truncate">
        {run.repo}
      </td>
      <td className="py-2 px-2 truncate">
        <span className="inline-block max-w-full truncate rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.72rem] text-[var(--settings-text-muted)]">
          {run.branch}
        </span>
      </td>
      <td className="py-2 px-2 whitespace-nowrap">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[0.72rem] font-medium capitalize ${conclusionBadgeClass(run.conclusion)}`}
        >
          {run.conclusion}
        </span>
      </td>
      <td className="py-2 px-2 whitespace-nowrap text-[var(--settings-text-muted)]">
        {relativeTime}
      </td>
      <td className="py-2 pl-2 pr-5">
        {run.conclusion === "failure" && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                className="flex size-6 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
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
          </TooltipProvider>
        )}
      </td>
    </tr>
  );
}
