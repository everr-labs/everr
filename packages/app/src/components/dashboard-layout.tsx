/* oxlint-disable typescript/no-base-to-string -- Preserve how existing URL search values are displayed, including JavaScript coercion. */
/* oxlint-disable typescript/restrict-template-expressions -- Preserve how existing URL search values are displayed, including JavaScript coercion. */
import { layouts } from "@composition/layouts";
import { AppShell } from "@everr/app-shell/shell";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useMatches, useRouteContext, useSearch } from "@tanstack/react-router";
import { homeView } from "#app/common/onboarding.ts";
import { CommandBar } from "#app/components/command-bar.tsx";
import { PreviewIndicator } from "#app/components/preview-indicator.tsx";
import { homeStatusQueryOptions } from "#app/data/onboarding/options.ts";
import { TimeAnchorProvider } from "#app/hooks/time-anchor.tsx";
import { navGroups } from "#app/lib/navigation.ts";

export function DashboardLayout() {
  const { session } = useRouteContext({ from: "/_authenticated" });
  const search = useSearch({ strict: false });

  // Structurally shared: the router updates matches at every navigation step,
  // and re-rendering the whole shell on each was most of a navigation's cost.
  const matches = useMatches({
    select: (all) =>
      all.map((match) => ({
        routeId: match.routeId,
        setupRequested: "setup" in match.search && match.search.setup === 1,
      })),
    structuralSharing: true,
  });
  const homeMatch = matches.find(
    (match) =>
      match.routeId === "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_padded/",
  );
  const homeStatus = useQuery({
    ...homeStatusQueryOptions(session.user.id, session.session.activeOrganizationId ?? ""),
    enabled: Boolean(homeMatch && session.session.activeOrganizationId),
    // Home owns the poll; the layout only observes its cached view decision.
    refetchInterval: false,
  });
  // The account pages share this shell but not the organization's time range.
  const hasTimeRange = matches.some(
    (match) => match.routeId === "/_authenticated/_organization/_dashboard",
  );
  // Home decides for itself; every other page leaves it to its routes.
  let hideTimeRangePicker: boolean | undefined;
  if (homeMatch) {
    hideTimeRangePicker = homeView(homeStatus.data, homeMatch.setupRequested) !== "dashboard";
  }

  if (!session.session.activeOrganizationId) {
    return <Outlet />;
  }

  return (
    <AppShell
      nav={navGroups}
      sidebarFooter={<layouts.UserMenu />}
      dataActions={
        <>
          <PreviewIndicator />
          <CommandBar />
        </>
      }
      hideTimeRangePicker={hideTimeRangePicker}
    >
      {search.github_install === "linked" && (
        <div className="mx-3 mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          GitHub installation linked successfully.
        </div>
      )}

      {search.github_install === "error" && (
        <div className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Failed to link GitHub installation
          {search.reason ? ` (${search.reason})` : ""}.
        </div>
      )}
      {hasTimeRange ? (
        <TimeAnchorProvider>
          <Outlet />
        </TimeAnchorProvider>
      ) : (
        <Outlet />
      )}
    </AppShell>
  );
}
