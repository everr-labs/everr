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
import { withTimeRange } from "@everr/ui/lib/time-range";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  useMatch,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import {
  DetailRouteDialog,
  useDetailRouteDialogClose,
} from "@/components/detail-route-dialog";
import { ExploreSearchShape } from "../explore/explore-search";
import { ExploreShell } from "../explore/explore-shell";
import { LocalTelemetryGate } from "../local-telemetry/collector-status";
import { localSqlClient } from "../logs/local-sql-client";

export { ErrorIssueSearchSchema };

// service/environment live in the shared Explore topbar but must also be in the
// route schema so the leaf route's validateSearch doesn't strip them. The
// triage status shape is not added: local Errors carry no triage Status until
// the Collector grows a counterpart events table (ADR 0004).
export const ErrorsListSearchSchema =
  ErrorIssueSearchSchema.extend(ExploreSearchShape);

const localErrorsRepo = new ErrorsRepository(localSqlClient);
const localTracesRepo = new TracesRepository(localSqlClient);

export function ErrorsPage() {
  const errorDetailMatch = useMatch({
    from: "/shell/errors/$fingerprint",
    shouldThrow: false,
  });
  const search = useSearch({ strict: false }) as ErrorIssueSearch;
  const navigate = useNavigate();

  // Always keep the list mounted in the same position so opening/closing the
  // modal never remounts it (a remount resets the virtualized list and re-runs
  // queries, which shows up as a flash on close).
  return (
    <>
      <ErrorsListView />
      {errorDetailMatch && (
        <DetailRouteDialog
          title="Error detail"
          onClose={() =>
            navigate({ to: "/errors", search: { ...search, occurrence: "" } })
          }
        >
          <Outlet />
        </DetailRouteDialog>
      )}
    </>
  );
}

function ErrorsListView() {
  const search = useSearch({ strict: false }) as ErrorIssueSearch & {
    environment?: string[];
  };
  const navigate = useNavigate();
  const {
    timeRange,
    q,
    service: searchService,
    fingerprint,
    sort,
    refresh,
    attributes,
  } = withTimeRange(search);
  // `service`/`environment` are default-free in the schema (so retainSearchParams
  // can persist them), so coalesce to [] before the filters read `.length`.
  const service = searchService ?? [];
  const environment = search.environment ?? [];

  return (
    <ExploreShell
      title="Errors"
      timeRange={timeRange}
      refresh={refresh ?? ""}
      service={service}
      environment={environment}
      onTimeRangeChange={(range) =>
        navigate({
          to: "/errors",
          search: { ...search, from: range.from, to: range.to },
          replace: true,
        })
      }
      onRefreshChange={(value) =>
        navigate({
          to: "/errors",
          search: { ...search, refresh: value || undefined },
          replace: true,
        })
      }
      onServiceChange={(values) =>
        navigate({
          to: "/errors",
          search: { ...search, service: values },
          replace: true,
        })
      }
      onEnvironmentChange={(values) =>
        navigate({
          to: "/errors",
          search: { ...search, environment: values },
          replace: true,
        })
      }
    >
      <LocalTelemetryGate>
        <ErrorIssues
          repo={localErrorsRepo}
          timeRange={timeRange}
          refresh={refresh ?? ""}
          search={{ q, service, fingerprint, sort, attributes }}
          environment={environment}
          hideSharedFilters
          onSearchChange={(patch) =>
            navigate({
              to: "/errors",
              search: { ...search, ...patch },
              replace: true,
            })
          }
          renderIssueLink={({ fingerprint: issueFingerprint, children }) => (
            <Link
              to="/errors/$fingerprint"
              params={{ fingerprint: issueFingerprint }}
              search={{ ...search, occurrence: "" }}
              className="block text-foreground no-underline"
            >
              {children}
            </Link>
          )}
        />
      </LocalTelemetryGate>
    </ExploreShell>
  );
}

export function ErrorDetailPage() {
  const { fingerprint } = useParams({ strict: false }) as {
    fingerprint: string;
  };
  const search = useSearch({ strict: false }) as ErrorIssueSearch;
  const navigate = useNavigate();
  // Inside the modal, ask the dialog to close through the route owner so the
  // dialog stays open until navigation removes it.
  const closeDialog = useDetailRouteDialogClose();
  const { timeRange, service, refresh } = withTimeRange(search);

  return (
    <LocalTelemetryGate>
      <ErrorDetail
        repo={localErrorsRepo}
        fingerprint={fingerprint}
        timeRange={timeRange}
        refresh={refresh ?? ""}
        service={service ?? []}
        occurrence={search.occurrence}
        onClose={() => {
          if (closeDialog) {
            closeDialog();
            return;
          }
          navigate({
            to: "/errors",
            search: { ...search, occurrence: "" },
          });
        }}
        renderOccurrenceLink={({
          occurrence: linkedOccurrence,
          children,
          isSelected,
        }) => (
          <Link
            to="/errors/$fingerprint"
            params={{ fingerprint }}
            search={{
              ...search,
              occurrence: getErrorOccurrenceKey(linkedOccurrence),
            }}
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
    </LocalTelemetryGate>
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
