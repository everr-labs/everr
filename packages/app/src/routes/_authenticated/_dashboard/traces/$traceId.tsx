import {
  computeDetailWindow,
  getTraceOptions,
  TraceDetail,
  TraceDetailParamsSchema,
} from "@everr/telemetry-explorer/traces";
import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { createFileRoute, Link } from "@tanstack/react-router";
import { remoteTracesRepo } from "@/data/traces/remote-repo";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/traces/$traceId",
)({
  staticData: { breadcrumb: "Trace", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Trace" }] }),
  validateSearch: TraceDetailParamsSchema,
  loaderDeps: ({ search }) => ({
    start: search.start,
    end: search.end,
    from: search.from,
    to: search.to,
    refresh: search.refresh,
  }),
  loader: async ({ context: { queryClient }, params, deps }) => {
    await queryClient.ensureQueryData(
      getTraceOptions({
        repo: remoteTracesRepo,
        traceId: params.traceId,
        window: computeDetailWindow({
          start: deps.start,
          end: deps.end,
          timeRange: { from: deps.from, to: deps.to },
        }),
        refresh: deps.refresh ?? "",
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
    <TraceDetail
      repo={remoteTracesRepo}
      traceId={traceId}
      search={search}
      onBack={() =>
        navigate({
          to: "/traces",
          search: {
            from: search.from,
            to: search.to,
            refresh: search.refresh,
          },
        })
      }
      onSpanChange={(spanId) =>
        navigate({
          search: (prev) => ({ ...prev, span: spanId }),
          replace: true,
        })
      }
    />
  );
}

function TraceDetailError({ error }: { error: Error }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Failed to load trace</EmptyTitle>
        <EmptyDescription>{error.message}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" render={<Link to="/traces" />}>
        Back to traces
      </Button>
    </Empty>
  );
}
