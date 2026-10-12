import { createFileRoute } from "@tanstack/react-router";
import {
  TraceDetailPage,
  TraceDetailSearchSchema,
} from "../features/traces/traces-page";
export const Route = createFileRoute("/_shell/traces_/$traceId")({
  validateSearch: TraceDetailSearchSchema,
  component: TraceDetailPage,
});
