import { resolve } from "@everr/datemath";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@everr/ui/components/empty";
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
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Clipboard, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { invokeCommand, NOTIFIER_CHECKED_EVENT } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import { formatNotificationRelativeTime } from "../../notification-time";
import { runsListQueryKey } from "./query-keys";

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
  displayTitle?: string | null;
  headSha?: string | null;
};

function resolveToISO(expr: string, roundUp: boolean): string {
  return resolve(expr, { roundUp }).toISOString();
}

function getRunsList(timeRange: TimeRange) {
  return invokeCommand<RunListItem[]>("get_runs_list", {
    from: resolveToISO(timeRange.from, false),
    to: resolveToISO(timeRange.to, true),
  });
}

function useNow(tickMs: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), tickMs);
    return () => window.clearInterval(id);
  }, [tickMs]);
  return now;
}

export function NotificationsPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>({
    from: "now-1h",
    to: "now",
  });
  useInvalidateOnTauriEvent(NOTIFIER_CHECKED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: runsListQueryKey });
  });

  const runsQuery = useQuery({
    queryKey: [...runsListQueryKey, timeRange.from, timeRange.to],
    queryFn: () => getRunsList(timeRange),
    staleTime: 0,
    refetchInterval: 30_000,
  });

  const runs = runsQuery.data ?? [];
  const now = useNow(30_000);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch pl-[var(--titlebar-inset)]"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            Your CI runs
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TimeRangePicker value={timeRange} onChange={setTimeRange} />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                  No CI pipeline runs match the selected time range. Try
                  expanding the range or check back later.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[0.78rem] table-fixed">
              <thead>
                <tr className="border-b border-white/[0.06] text-[0.7rem] font-medium uppercase tracking-wider text-[var(--settings-text-muted)]">
                  <th className="py-2 pl-5 pr-2 font-medium">Workflow</th>
                  <th className="py-2 px-2 font-medium">Repository</th>
                  <th className="py-2 px-2 font-medium">Branch</th>
                  <th className="py-2 px-2 font-medium">Commit</th>
                  <th className="py-2 px-2 font-medium">Result</th>
                  <th className="py-2 px-2 font-medium">When</th>
                  <th className="w-10 py-2 pl-2 pr-5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <RunRow key={run.traceId} run={run} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
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

function RunRow({ run, now }: { run: RunListItem; now: Date }) {
  const relativeTime = formatNotificationRelativeTime(run.timestamp, { now });
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

  return (
    <tr className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]">
      <td className="py-2 pl-5 pr-2 font-medium truncate">
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
      <td className="py-2 px-2">
        {run.headSha && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.72rem] text-[var(--settings-text-muted)]">
                {run.headSha.slice(0, 7)}
              </TooltipTrigger>
              {run.displayTitle && (
                <TooltipContent side="top">{run.displayTitle}</TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        )}
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
