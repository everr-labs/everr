import { createFileRoute } from "@tanstack/react-router";
import { CiPage, CiSearchSchema } from "../features/ci/ci-page";
export const Route = createFileRoute("/_shell/ci")({
  validateSearch: CiSearchSchema,
  component: CiPage,
});
