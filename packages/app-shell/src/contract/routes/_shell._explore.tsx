import { createFileRoute } from "@tanstack/react-router";
import { ExploreLayout } from "../../explore/pages";
import { exploreLayoutRoute } from "../../explore/routes";

export const Route = createFileRoute("/_shell/_explore")({
  ...exploreLayoutRoute,
  component: ExploreLayout,
});
