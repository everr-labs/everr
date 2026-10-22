import {
  getTraceOptions,
  TraceDetailParamsSchema,
  TraceExplorer,
  toTraceListSearch,
} from "@everr/telemetry-explorer/traces";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import {
  createFileRoute,
  type ErrorComponentProps,
  Link,
} from "@tanstack/react-router";
import { remoteTracesRepo } from "#app/data/traces/remote-repo.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/traces_/$traceId",
)({
  staticData: {
    breadcrumb: "Trace",
    hideExploreBar: true,
    hideTimeRangePicker: true,
  },
  head: () => ({ meta: [{ title: "Everr - Trace" }] }),
  validateSearch: TraceDetailParamsSchema,
  loader: async ({ context: { queryClient }, params }) => {
    await queryClient.ensureQueryData(
      getTraceOptions({
        repo: remoteTracesRepo,
        traceId: params.traceId,
        refresh: "off",
      }),
    );
  },
  component: TraceDetailRoute,
  errorComponent: TraceDetailError,
});

function TraceDetailRoute() {
  const { traceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <TraceExplorer
      repo={remoteTracesRepo}
      traceId={traceId}
      search={search}
      onBack={() =>
        navigate({
          to: "/traces",
          search: toTraceListSearch(search),
        })
      }
      onSpanChange={(spanId) =>
        navigate({
          to: "/traces/$traceId",
          params: { traceId },
          search: (prev) => ({ ...prev, span: spanId }),
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}

function TraceDetailError({ error }: ErrorComponentProps) {
  const search = Route.useSearch();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Failed to load trace</EmptyTitle>
        <EmptyDescription>
          {error instanceof Error ? error.message : String(error)}
        </EmptyDescription>
      </EmptyHeader>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/traces" search={toTraceListSearch(search)} />}
      >
        Back to traces
      </Button>
    </Empty>
  );
}
