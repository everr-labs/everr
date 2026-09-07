import {
  type RenderRunLink,
  type RenderRunRowActions,
  RUN_STATUS_FILTERS,
  RunsExplorer,
  type RunsExplorerSearch,
} from "@everr/telemetry-explorer/runs";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { DEFAULT_TIME_RANGE, type TimeRange } from "@everr/ui/lib/time-range";
import {
  useIsFetching,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Check, Clipboard, Mail, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import {
  invokeCommand,
  NOTIFIER_CHECKED_EVENT,
  SETTINGS_CHANGED_EVENT,
} from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import { AuthStandalone, useAuthStatusQuery } from "../auth/auth";
import { PageTitleBar } from "../desktop-shell/title-bar";
import { notificationEmailsQueryKey } from "../notifications/query-keys";
import { ciRunsRepository } from "./ci-runs-repository";

export const CiSearchSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  refresh: z.string().optional(),
  runId: z.string().optional(),
  repos: z.array(z.string()).default([]).catch([]),
  branches: z.array(z.string()).default([]).catch([]),
  workflowNames: z.array(z.string()).default([]).catch([]),
  conclusions: z.array(z.enum(RUN_STATUS_FILTERS)).default([]).catch([]),
  onlyMine: z.boolean().default(true).catch(true),
  showVolume: z.boolean().default(true).catch(true),
});

type CiSearch = z.infer<typeof CiSearchSchema>;

export function CiPage() {
  const authStatusQuery = useAuthStatusQuery();

  if (authStatusQuery.isPending) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--settings-text-muted)]">
        Loading {APP_DISPLAY_NAME}…
      </div>
    );
  }

  if (authStatusQuery.data?.status !== "signed_in") {
    return <CiSignInPrompt />;
  }

  return <CiContent />;
}

function CiSignInPrompt() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-14">
      <Card className="w-full max-w-[420px] border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
        <CardContent className="px-6 py-8">
          <AuthStandalone
            title="Sign in to view your CI runs"
            description="Connect Everr Cloud to monitor your pipelines."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function CiContent() {
  const search = useSearch({ strict: false }) as CiSearch;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Scope to the runs queries so the indicator + refresh don't react to / refetch
  // unrelated queries (auth, profile, collector status, …).
  const isFetching = useIsFetching({ queryKey: ["runs"] }) > 0;

  const refresh = search.refresh ?? "";
  const refreshMs = useMemo(
    () => (refresh ? getRefreshIntervalMs(refresh) : null),
    [refresh],
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (refreshMs) {
      intervalRef.current = setInterval(
        () => void queryClient.invalidateQueries({ queryKey: ["runs"] }),
        refreshMs,
      );
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshMs, queryClient]);

  useInvalidateOnTauriEvent(NOTIFIER_CHECKED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: ["runs"] });
  });

  // Without a notification email, "Your runs" can't match CI events to the
  // signed-in user, so warn and point at where to set one.
  const notificationEmailsQuery = useQuery({
    queryKey: notificationEmailsQueryKey,
    queryFn: () => invokeCommand<string[]>("get_notification_emails"),
  });
  useInvalidateOnTauriEvent(SETTINGS_CHANGED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: notificationEmailsQueryKey });
  });
  const showNoEmailNotice =
    search.onlyMine && notificationEmailsQuery.data?.length === 0;

  const timeRange: TimeRange = {
    from: search.from ?? DEFAULT_TIME_RANGE.from,
    to: search.to ?? DEFAULT_TIME_RANGE.to,
  };

  const explorerSearch: RunsExplorerSearch = {
    runId: search.runId,
    repos: search.repos,
    branches: search.branches,
    conclusions: search.conclusions,
    workflowNames: search.workflowNames,
    onlyMine: search.onlyMine,
    showVolume: search.showVolume,
  };

  // Stable identities so the explorer's row itemContent (and thus Virtuoso)
  // doesn't re-render every row whenever this component re-renders.
  const renderRunLink: RenderRunLink = useCallback(
    ({ run, className, children }) => (
      <button
        type="button"
        className={className}
        onClick={() =>
          void invokeCommand("open_run_in_browser", { traceId: run.traceId })
        }
      >
        {children}
      </button>
    ),
    [],
  );
  const renderRowActions: RenderRunRowActions = useCallback(
    (run) =>
      run.conclusion === "failure" ? (
        <CopyFixPromptButton traceId={run.traceId} />
      ) : null,
    [],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar
        title="CI runs"
        actions={
          <>
            <TimeRangePicker
              value={timeRange}
              onChange={(range) =>
                navigate({
                  to: "/ci",
                  search: (prev) => ({
                    ...prev,
                    from: range.from,
                    to: range.to,
                  }),
                  replace: true,
                })
              }
            />
            <RefreshPicker
              value={refresh}
              onChange={(value) =>
                navigate({
                  to: "/ci",
                  search: (prev) => ({ ...prev, refresh: value || undefined }),
                  replace: true,
                })
              }
              onRefresh={() =>
                void queryClient.invalidateQueries({ queryKey: ["runs"] })
              }
              isFetching={isFetching}
            />
          </>
        }
      />
      {showNoEmailNotice ? (
        <div
          role="status"
          className="flex shrink-0 items-center gap-3 border-b border-amber-500/20 bg-amber-500/[0.08] px-3 py-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-200"
        >
          <TriangleAlert
            aria-hidden
            className="size-4 shrink-0 text-amber-400"
          />
          <p className="min-w-0 flex-1 text-pretty text-sm text-foreground">
            No notification email set — add one so{" "}
            <span className="font-medium">Your runs</span> can match your CI
            activity.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => navigate({ to: "/settings" })}
          >
            <Mail className="size-3.5" />
            Add notification email
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <RunsExplorer
          repo={ciRunsRepository}
          timeRange={timeRange}
          search={explorerSearch}
          showMineFilter
          onSearchChange={(patch) =>
            navigate({
              to: "/ci",
              search: (prev) => ({ ...prev, ...patch }),
              replace: true,
            })
          }
          onTimeRangeSelect={(from, to) =>
            navigate({
              to: "/ci",
              search: (prev) => ({
                ...prev,
                from: from.toISOString(),
                to: to.toISOString(),
              }),
              replace: true,
            })
          }
          renderRunLink={renderRunLink}
          renderRowActions={renderRowActions}
        />
      </div>
    </div>
  );
}

function CopyFixPromptButton({ traceId }: { traceId: string }) {
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copyMutation = useMutation({
    mutationFn: () =>
      invokeCommand<void>("copy_run_auto_fix_prompt", { traceId }),
    onSuccess() {
      clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    },
  });

  return (
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
  );
}
