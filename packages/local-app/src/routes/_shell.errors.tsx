import { createFileRoute } from "@tanstack/react-router";
import {
  ErrorsListSearchSchema,
  ErrorsPage,
} from "../features/errors/errors-page";
export const Route = createFileRoute("/_shell/errors")({
  validateSearch: ErrorsListSearchSchema,
  component: ErrorsPage,
});
