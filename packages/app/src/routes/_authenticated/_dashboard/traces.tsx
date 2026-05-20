import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { TracesSearchPage } from "@/components/traces/traces-search-page";
import { TraceSearchParamsSchema } from "@/data/traces/schemas";

export const Route = createFileRoute("/_authenticated/_dashboard/traces")({
  staticData: { breadcrumb: "Traces", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
  validateSearch: TraceSearchParamsSchema,
  component: TracesRoute,
});

export function TracesRoute() {
  const traceDetailMatch = useMatch({
    from: "/_authenticated/_dashboard/traces/$traceId",
    shouldThrow: false,
  });

  return traceDetailMatch ? <Outlet /> : <TracesSearchPage />;
}
