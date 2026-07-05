import { TraceDetailParamsSchema, toTraceListSearch } from "@everr/telemetry-explorer/traces";
import { createFileRoute } from "@tanstack/react-router";
import {
  ensureTraceDetailData,
  getTraceDetailLoaderDeps,
  TraceDetailRouteContent,
  TraceDetailRouteError,
} from "./-trace-detail";

export const Route = createFileRoute("/_authenticated/_dashboard/_explore/traces_/$traceId")({
  staticData: { breadcrumb: "Trace", hideExploreBar: true },
  validateSearch: TraceDetailParamsSchema,
  loaderDeps: ({ search }) => getTraceDetailLoaderDeps(search),
  loader: async ({ context: { queryClient }, params, deps }) => {
    await ensureTraceDetailData({
      queryClient,
      traceId: params.traceId,
      deps,
    });
  },
  head: () => ({ meta: [{ title: "Everr - Trace" }] }),
  component: TraceDetailRoute,
  errorComponent: TraceDetailError,
});

function TraceDetailRoute() {
  const { traceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <TraceDetailRouteContent
      traceId={traceId}
      search={search}
      onBack={() =>
        void navigate({
          to: "/traces",
          search: toTraceListSearch(search),
        })
      }
      onSpanChange={(spanId) =>
        void navigate({
          to: "/traces/$traceId",
          params: { traceId },
          search: (prev) => ({ ...prev, span: spanId }),
          replace: true,
        })
      }
    />
  );
}

function TraceDetailError({ error }: { error: Error }) {
  return <TraceDetailRouteError error={error} search={Route.useSearch()} />;
}
