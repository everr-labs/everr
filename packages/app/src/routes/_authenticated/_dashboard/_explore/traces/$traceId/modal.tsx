import {
  TraceDetailParamsSchema,
  toTraceListSearch,
} from "@everr/telemetry-explorer/traces";
import { createFileRoute } from "@tanstack/react-router";
import { DetailRouteDialog } from "@/components/detail-route-dialog";
import {
  ensureTraceDetailData,
  getTraceDetailLoaderDeps,
  TraceDetailRouteContent,
  TraceDetailRouteError,
} from "../../-trace-detail";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_explore/traces/$traceId/modal",
)({
  staticData: { breadcrumb: "Trace", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Trace" }] }),
  validateSearch: TraceDetailParamsSchema,
  loaderDeps: ({ search }) => getTraceDetailLoaderDeps(search),
  loader: async ({ context: { queryClient }, params, deps }) => {
    await ensureTraceDetailData({
      queryClient,
      traceId: params.traceId,
      deps,
    });
  },
  component: TraceDetailModalRoute,
  errorComponent: TraceDetailModalError,
});

function TraceDetailModalRoute() {
  const { traceId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <DetailRouteDialog
      title="Trace detail"
      onClose={() =>
        navigate({
          to: "/traces",
          search: toTraceListSearch(search),
        })
      }
    >
      <TraceDetailRouteContent
        traceId={traceId}
        search={search}
        onClose={() =>
          navigate({
            to: "/traces",
            search: toTraceListSearch(search),
          })
        }
        onSpanChange={(spanId) =>
          navigate({
            to: "/traces/$traceId/modal",
            params: { traceId },
            search: (prev) => ({ ...prev, span: spanId }),
            replace: true,
          })
        }
      />
    </DetailRouteDialog>
  );
}

function TraceDetailModalError({ error }: { error: Error }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <DetailRouteDialog
      title="Trace detail"
      onClose={() =>
        navigate({
          to: "/traces",
          search: toTraceListSearch(search),
        })
      }
    >
      <TraceDetailRouteError error={error} search={search} />
    </DetailRouteDialog>
  );
}
