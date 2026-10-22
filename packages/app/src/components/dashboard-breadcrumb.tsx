import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@everr/ui/components/breadcrumb";
import { Link, useMatches } from "@tanstack/react-router";
import { Fragment } from "react";
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

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={`${crumb.label}-${String(i)}`}>
              {i > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem className={isLast ? undefined : "hidden md:block"}>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
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
