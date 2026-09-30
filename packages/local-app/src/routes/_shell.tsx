import {
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { AppShell } from "../features/app-shell/app-shell";
import { ExploreSearchSchema } from "../features/explore/explore-search";
export const Route = createFileRoute("/_shell")({
  validateSearch: ExploreSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({ service: [], environment: [] }),
      retainSearchParams(["service", "environment"]),
    ],
  },
  component: AppShell,
});
