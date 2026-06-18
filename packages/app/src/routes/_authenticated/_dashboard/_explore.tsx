import { createFileRoute, Outlet, useMatches } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_dashboard/_explore")({
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

  // The shared filter bar is added in later tasks; for now this layout is a
  // transparent passthrough so behavior is unchanged.
  void hideExploreBar;

  return <Outlet />;
}
