import { Link, useMatches } from "@tanstack/react-router";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface Crumb {
  label: string;
  to: string;
  search?: Record<string, unknown>;
}

export function DashboardBreadcrumb() {
  const matches = useMatches();

  const crumbs: Crumb[] = [];
  for (const match of matches) {
    const bc = match.staticData?.breadcrumb;
    if (!bc) continue;
    const result = typeof bc === "function" ? bc(match) : bc;
    if (!result) continue;
    if (typeof result === "string") {
      crumbs.push({ label: result, to: match.fullPath });
    } else {
      for (const seg of result) {
        crumbs.push({
          label: seg.label,
          to: match.fullPath,
          search: seg.search,
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
            <Fragment key={`${crumb.to}-${String(i)}`}>
              {i > 0 && <BreadcrumbSeparator className="hidden md:block" />}
              <BreadcrumbItem
                className={isLast ? undefined : "hidden md:block"}
              >
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    render={
                      <Link
                        to={crumb.to}
                        search={
                          crumb.search
                            ? (prev: Record<string, unknown>) => ({
                                ...prev,
                                ...crumb.search,
                              })
                            : undefined
                        }
                      />
                    }
                  >
                    {crumb.label}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
