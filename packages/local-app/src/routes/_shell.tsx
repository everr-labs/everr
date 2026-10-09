import { ExploreSearchSchema } from "@everr/telemetry-explorer/filters";
import {
  createFileRoute,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { AppShell } from "../features/app-shell/app-shell";
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
