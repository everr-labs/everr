import {
  TraceDetail,
  type TraceDetailParams,
  TraceDetailParamsSchema,
  type TraceSearchParams,
  TraceSearchParamsSchema,
  TracesRepository,
  TracesSearch,
  toTraceListSearch,
} from "@everr/telemetry-explorer/traces";
import {
  getRefreshIntervalMs,
  RefreshPicker,
} from "@everr/ui/components/refresh-picker";
import { TimeRangePicker } from "@everr/ui/components/time-range-picker";
import { type TimeRange, withTimeRange } from "@everr/ui/lib/time-range";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useMatch,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef } from "react";
import {
  DetailRouteDialog,
  useDetailRouteDialogClose,
} from "@/components/detail-route-dialog";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "../logs/local-sql-client";

export { TraceDetailParamsSchema, TraceSearchParamsSchema };

const localTracesRepo = new TracesRepository(localSqlClient);

export function TracesPage() {
  const traceDetailMatch = useMatch({
    from: "/authenticated/traces/$traceId",
    shouldThrow: false,
  });
  const search = useSearch({ strict: false }) as TraceDetailParams;
  const navigate = useNavigate();

  // Always keep the list mounted in the same position so opening/closing the
  // modal never remounts it (a remount resets the virtualized list and re-runs
  // queries, which shows up as a flash on close).
  return (
    <>
      <TracesListView />
      {traceDetailMatch && (
        <DetailRouteDialog
          title="Trace detail"
          onClose={() =>
            navigate({ to: "/traces", search: toTraceListSearch(search) })
          }
        >
          <Outlet />
        </DetailRouteDialog>
      )}
    </>
  );
}

function TracesListView() {
  const search = useSearch({ strict: false }) as TraceSearchParams;
  const navigate = useNavigate();
  const { timeRange } = withTimeRange(search);
  const refresh = search.refresh ?? "";

  return (
    <TracePageShell
      title="Traces"
      timeRange={timeRange}
      refresh={refresh}
      onTimeRangeChange={(range) =>
        navigate({
          to: "/traces",
          search: (prev) => ({ ...prev, from: range.from, to: range.to }),
          replace: true,
        })
      }
      onRefreshChange={(value) =>
        navigate({
          to: "/traces",
          search: (prev) => ({ ...prev, refresh: value || undefined }),
          replace: true,
        })
      }
    >
      <LocalTelemetryGate>
        <TracesSearch
          repo={localTracesRepo}
          timeRange={timeRange}
          refresh={refresh}
          search={{
            namespace: search.namespace,
            service: search.service,
            name: search.name,
            minMs: search.minMs,
            maxMs: search.maxMs,
            status: search.status,
            attributes: search.attributes,
          }}
          onSearchChange={(patch) =>
            navigate({
              to: "/traces",
              search: (prev) => ({ ...prev, ...patch }),
              replace: true,
            })
          }
          renderTraceLink={({ traceId, start, end, className, children }) => (
            <Link
              to="/traces/$traceId"
              params={{ traceId }}
              search={(prev) => ({ ...prev, start, end })}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      </LocalTelemetryGate>
    </TracePageShell>
  );
}

export function TraceDetailPage() {
  const { traceId } = useParams({ strict: false }) as { traceId: string };
  const search = useSearch({ strict: false }) as TraceDetailParams;
  const navigate = useNavigate();
  // Inside the modal, ask the dialog to close through the route owner so the
  // dialog stays open until navigation removes it.
  const closeDialog = useDetailRouteDialogClose();
  return (
    <LocalTelemetryGate>
      <TraceDetail
        repo={localTracesRepo}
        traceId={traceId}
        search={search}
        onBack={() => {
          if (closeDialog) {
            closeDialog();
            return;
          }
          navigate({ to: "/traces", search: toTraceListSearch(search) });
        }}
        onSpanChange={(spanId) =>
          navigate({
            to: "/traces/$traceId",
            params: { traceId },
            search: (prev) => ({ ...prev, span: spanId }),
            replace: true,
          })
        }
      />
    </LocalTelemetryGate>
  );
}

function TracePageShell({
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
