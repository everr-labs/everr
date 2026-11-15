import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@everr/ui/components/breadcrumb";
import { Link, useMatches } from "@tanstack/react-router";
import { cn } from "@everr/ui/lib/utils";
import { Fragment } from "react";
import { findNavSection } from "#app/lib/navigation.ts";
import type { BreadcrumbSegment } from "#app/router-types.ts";

export function DashboardBreadcrumb() {
  const matches = useMatches();

  const crumbs: Required<BreadcrumbSegment>[] = [];
  for (const match of matches) {
    const bc = match.staticData?.breadcrumb;
    if (!bc) continue;
    const result = typeof bc === "function" ? bc(match) : bc;
    if (!result) continue;
    if (typeof result === "string") {
      crumbs.push({
        label: result,
        link: <Link from={match.fullPath} to="." params={match.params} />,
      });
    } else {
      for (const seg of result) {
        crumbs.push({
          label: seg.label,
          link: seg.link ?? <Link from={match.fullPath} to="." params={match.params} />,
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
                {isLast ? (
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
