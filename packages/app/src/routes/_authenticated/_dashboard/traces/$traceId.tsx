import { createFileRoute } from "@tanstack/react-router";
import {
  TraceDetailError,
  TraceDetailPage,
} from "@/components/traces/trace-detail-page";
import { getTraceOptions } from "@/data/traces/options";
import { TraceDetailParamsSchema } from "@/data/traces/schemas";
import { computeDetailWindow } from "@/data/traces/window";

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
  component: TraceDetailPage,
  errorComponent: TraceDetailError,
});
