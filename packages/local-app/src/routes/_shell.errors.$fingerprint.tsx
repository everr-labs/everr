import { createFileRoute } from "@tanstack/react-router";
import {
  ErrorDetailPage,
  ErrorsListSearchSchema,
} from "../features/errors/errors-page";
export const Route = createFileRoute("/_shell/errors/$fingerprint")({
  validateSearch: ErrorsListSearchSchema,
  component: ErrorDetailPage,
});
