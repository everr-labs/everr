import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@everr/ui/components/breadcrumb";
import { Skeleton } from "@everr/ui/components/skeleton";
import { cn } from "@everr/ui/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useMatches, useRouter, useRouterState } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";
import { findNavSection } from "#app/lib/navigation.ts";
import type { BreadcrumbSegment } from "#app/router-types.ts";

export function DashboardBreadcrumb() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const presented = useMatches();
  // While a navigation loads, the router keeps the previous page on screen but
  // the URL and the sidebar already name the next one. The breadcrumb follows
  // them: it resolves the location being loaded. Matches the router already
  // holds are reused, so a crumb read from loader data (a dashboard's name)
  // stays put across a search-only change. A new page's crumb reads what the
  // cache already knows (the list it was clicked from), and draws a skeleton
  // only when nothing does.
  const pendingLocation = useRouterState({
    select: (state) => (state.status === "pending" ? state.location : undefined),
  });
  const matches = useMemo(
    () => (pendingLocation ? router.matchRoutes(pendingLocation) : presented),
    [router, pendingLocation, presented],
  );

  const crumbs: (Required<Omit<BreadcrumbSegment, "unresolved">> & { pending: boolean })[] = [];
  for (const match of matches) {
    const bc = match.staticData?.breadcrumb;
    if (!bc) continue;
    const result = typeof bc === "function" ? bc(match, { queryClient }) : bc;
    if (!result) continue;
    if (typeof result === "string") {
      crumbs.push({
        label: result,
        link: <Link from={match.fullPath} to="." params={match.params} />,
        pending: false,
      });
    } else {
      for (const seg of result) {
        crumbs.push({
          label: seg.label,
          link: seg.link ?? <Link from={match.fullPath} to="." params={match.params} />,
          // A stand-in label only shows once the page has settled without
          // the real one (a missing resource), never mid-navigation.
          pending: Boolean(seg.unresolved && pendingLocation),
        });
      }
    }
  }

  if (crumbs.length === 0) return null;

  const section = findNavSection(matches.at(-1)?.pathname ?? "");

  return (
    <Breadcrumb className="min-w-0">
      {/* One line: the header is a fixed 48px, so the current page truncates
          instead of wrapping out of it. */}
      <BreadcrumbList className="flex-nowrap">
        {/* The section's sidebar icon, in its colour, so the page carries the
            colour of the place you clicked. */}
        {section && (
          <BreadcrumbItem aria-hidden className={cn(section.group.accent, "shrink-0")}>
            <section.item.icon className="size-3.5 text-(--nav-accent)" />
          </BreadcrumbItem>
        )}
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${String(i)}`}>
              {i > 0 && <BreadcrumbSeparator className="hidden shrink-0 md:block" />}
              <BreadcrumbItem className={isLast ? "min-w-0" : "hidden shrink-0 md:inline-flex"}>
                {crumb.pending ? (
                  <Skeleton aria-hidden className="h-3.5 w-24 rounded-sm" />
                ) : isLast ? (
                  <BreadcrumbPage className="truncate" title={crumb.label}>
                    {crumb.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={crumb.link}>{crumb.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
