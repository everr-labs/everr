import { createFileRoute } from "@tanstack/react-router";
import { TracesRoute } from "@/components/traces/traces-route";
import { TraceSearchParamsSchema } from "@/data/traces/schemas";

export const Route = createFileRoute("/_authenticated/_dashboard/traces")({
  staticData: { breadcrumb: "Traces", fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Traces" }] }),
  validateSearch: TraceSearchParamsSchema,
  component: TracesRoute,
});
