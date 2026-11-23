import { ExploreLayout } from "@everr/telemetry-explorer/explore/pages";
import { exploreLayoutRoute } from "@everr/telemetry-explorer/explore/routes";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/_explore")({
  ...exploreLayoutRoute,
  component: ExploreLayout,
});
