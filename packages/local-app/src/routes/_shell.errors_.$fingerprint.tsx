import { createFileRoute } from "@tanstack/react-router";
import { ErrorDetailPage, ErrorsListSearchSchema } from "../features/errors/errors-page";
export const Route = createFileRoute("/_shell/errors_/$fingerprint")({
  validateSearch: ErrorsListSearchSchema,
  component: ErrorDetailPage,
});
