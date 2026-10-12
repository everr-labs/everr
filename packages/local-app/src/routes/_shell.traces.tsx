import { createFileRoute } from "@tanstack/react-router";
import {
  TracesListSearchSchema,
  TracesPage,
} from "../features/traces/traces-page";
export const Route = createFileRoute("/_shell/traces")({
  validateSearch: TracesListSearchSchema,
  component: TracesPage,
});
