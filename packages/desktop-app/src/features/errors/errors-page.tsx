import {
  ErrorDetail,
  type ErrorIssueSearch,
  ErrorIssueSearchSchema,
  ErrorIssues,
  type ErrorOccurrence,
  ErrorsRepository,
  ErrorTracePanel,
  getErrorOccurrenceKey,
  getErrorTraceWindow,
} from "@everr/telemetry-explorer/errors";
import {
  getTraceOptions,
  type Span,
  TracesRepository,
} from "@everr/telemetry-explorer/traces";
import { buttonVariants } from "@everr/ui/components/button";
import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import { type TimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { localSqlClient } from "../logs/local-sql-client";

export { ErrorIssueSearchSchema };

const localErrorsRepo = new ErrorsRepository(localSqlClient);
const localTracesRepo = new TracesRepository(localSqlClient);

export function ErrorsPage() {
  const search = useSearch({ strict: false }) as ErrorIssueSearch;
  const navigate = useNavigate();
  const { timeRange, q, service, fingerprint, sort, refresh } =
    withTimeRange(search);

  return (
    <ErrorsPageShell
      title="Errors"
      timeRange={timeRange}
      refresh={refresh ?? ""}
      onTimeRangeChange={(range) =>
        navigate({
          to: "/errors",
          search: (prev) => ({ ...prev, from: range.from, to: range.to }),
          replace: true,
        })
      }
      onRefreshChange={(value) =>
        navigate({
          to: "/errors",
          search: (prev) => ({ ...prev, refresh: value || undefined }),
          replace: true,
        })
      }
    >
      <ErrorIssues
        repo={localErrorsRepo}
        timeRange={timeRange}
        refresh={refresh ?? ""}
        search={{ q, service, fingerprint, sort }}
        onSearchChange={(patch) =>
          navigate({
            to: "/errors",
            search: (prev) => ({ ...prev, ...patch }),
            replace: true,
          })
        }
        renderIssueLink={({ fingerprint: issueFingerprint, children }) => (
          <Link
            to="/errors/$fingerprint"
            params={{ fingerprint: issueFingerprint }}
            search={(prev) => ({ ...prev, occurrence: "" })}
            className="block text-foreground no-underline"
          >
            {children}
          </Link>
        )}
      />
    </ErrorsPageShell>
  );
}

export function ErrorDetailPage() {
  const { fingerprint } = useParams({ strict: false }) as {
    fingerprint: string;
  };
  const search = useSearch({ strict: false }) as ErrorIssueSearch;
  const navigate = useNavigate();
  const { timeRange, service, refresh } = withTimeRange(search);

  return (
    <ErrorsPageShell
      title="Error"
      timeRange={timeRange}
      refresh={refresh ?? ""}
      onTimeRangeChange={(range) =>
        navigate({
          to: "/errors/$fingerprint",
          params: { fingerprint },
          search: (prev) => ({ ...prev, from: range.from, to: range.to }),
          replace: true,
        })
      }
      onRefreshChange={(value) =>
        navigate({
          to: "/errors/$fingerprint",
          params: { fingerprint },
          search: (prev) => ({ ...prev, refresh: value || undefined }),
          replace: true,
        })
      }
    >
      <ErrorDetail
        repo={localErrorsRepo}
        fingerprint={fingerprint}
        timeRange={timeRange}
        refresh={refresh ?? ""}
        service={service}
        occurrence={search.occurrence}
        renderBackLink={(children) => (
          <Link
            to="/errors"
            search={(prev) => ({ ...prev, occurrence: "" })}
            className={buttonVariants({
              variant: "outline",
              size: "sm",
              className: "shrink-0",
            })}
          >
            {children}
          </Link>
        )}
        renderOccurrenceLink={({
          occurrence: linkedOccurrence,
          children,
          isSelected,
        }) => (
          <Link
            to="/errors/$fingerprint"
            params={{ fingerprint }}
            search={(prev) => ({
              ...prev,
              occurrence: getErrorOccurrenceKey(linkedOccurrence),
            })}
            aria-current={isSelected ? "page" : undefined}
            className={buttonVariants({
              variant: isSelected ? "secondary" : "outline",
              size: "sm",
            })}
          >
            {children}
          </Link>
        )}
        renderTracePanel={({ occurrence }) => (
          <DesktopErrorTracePanel occurrence={occurrence} />
        )}
      />
    </ErrorsPageShell>
  );
}

function DesktopErrorTracePanel({
  occurrence,
}: {
  occurrence: ErrorOccurrence;
}) {
  const hasTrace = occurrence.traceId.length > 0;
  const { start, end } = getErrorTraceWindow(occurrence.timestamp);
  const traceQuery = useQuery({
    ...getTraceOptions({
      repo: localTracesRepo,
      traceId: occurrence.traceId,
      window: { fromTs: start, toTs: end },
      refresh: "",
    }),
    enabled: hasTrace,
  });
  const spans = (traceQuery.data ?? []).map((span: Span) => ({
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.spanName,
    durationMs: Number(span.duration) / 1_000_000,
    conclusion: span.statusCode,
    jobName: undefined,
  }));

  return (
    <ErrorTracePanel
      occurrence={occurrence}
      spans={spans}
      isPending={traceQuery.isPending && hasTrace}
      isError={traceQuery.isError}
      onRetry={() => void traceQuery.refetch()}
      renderTraceLink={({ traceId, spanId, start, end, children }) => (
        <Link
          to="/traces/$traceId"
          params={{ traceId }}
          search={(prev) => ({
            ...prev,
            span: spanId || undefined,
            start,
            end,
          })}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {children}
        </Link>
      )}
    />
  );
}

function ErrorsPageShell({
  title,
  timeRange,
  refresh,
  onTimeRangeChange,
  onRefreshChange,
  children,
}: {
  title: string;
  timeRange: TimeRange;
  refresh: string;
  onTimeRangeChange: (range: TimeRange) => void;
  onRefreshChange: (value: string) => void;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const isFetching = useIsFetching() > 0;
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
        () => void queryClient.invalidateQueries(),
        refreshMs,
      );
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshMs, queryClient]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch pl-[var(--titlebar-inset)]"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            {title}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <TimeRangePicker value={timeRange} onChange={onTimeRangeChange} />
          <RefreshPicker
            value={refresh}
            onChange={onRefreshChange}
            onRefresh={() => void queryClient.invalidateQueries()}
            isFetching={isFetching}
          />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
