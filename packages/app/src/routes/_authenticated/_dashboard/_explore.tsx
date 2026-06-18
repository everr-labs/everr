import {
  createFileRoute,
  Outlet,
  retainSearchParams,
  useMatches,
} from "@tanstack/react-router";
import { z } from "zod";

const ExploreSearchSchema = z.object({
  service: z.array(z.string()).default([]),
  environment: z.array(z.string()).default([]),
});

export const Route = createFileRoute("/_authenticated/_dashboard/_explore")({
  validateSearch: ExploreSearchSchema,
  search: {
    middlewares: [retainSearchParams(["service", "environment"])],
  },
  component: ExploreLayout,
});

function ExploreLayout() {
  const matches = useMatches();
  let hideExploreBar = false;
  for (const match of matches) {
    if (match.staticData?.hideExploreBar !== undefined) {
      hideExploreBar = match.staticData.hideExploreBar;
    }
  }
  void hideExploreBar; // consumed by the topbar added in Task 4

  return <Outlet />;
}
