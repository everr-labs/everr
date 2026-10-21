import { render, screen } from "@testing-library/react";
import { describe, expect, it, type Mock, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useMatches: vi.fn(),
  Link: ({
    to,
    from,
    params,
    search,
    children,
  }: {
    to: string;
    from?: string;
    params?: Record<string, string>;
    search?: Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>);
    children?: React.ReactNode;
  }) => {
    const route = to === "." ? (from ?? ".") : to;
    const path = route.replace(/\$([A-Za-z0-9_]+)/g, (segment, name: string) => {
      const value = params?.[name];
      return value === undefined ? segment : encodeURIComponent(value);
    });
    const resolvedSearch = typeof search === "function" ? search({ keep: "current" }) : search;
    const searchStr = resolvedSearch
      ? `?${new URLSearchParams(
          Object.entries(resolvedSearch)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()}`
      : "";
    return <a href={`${path}${searchStr}`}>{children}</a>;
  },
}));

import { Link, useMatches } from "@tanstack/react-router";
import type { BreadcrumbSegment } from "#app/router-types.ts";
import { DashboardBreadcrumb } from "./dashboard-breadcrumb";

const mockUseMatches = useMatches as Mock;

function makeMatch(
  fullPath: string,
  breadcrumb?:
    | string
    | ((match: Record<string, unknown>) => string | BreadcrumbSegment[] | undefined),
  extra?: Record<string, unknown>,
) {
  return {
    fullPath,
    staticData: breadcrumb !== undefined ? { breadcrumb } : {},
    ...extra,
  };
}

describe("DashboardBreadcrumb", () => {
  it("returns null when no matches have breadcrumb data", () => {
    mockUseMatches.mockReturnValue([{ fullPath: "/", staticData: {} }]);
    const { container } = render(<DashboardBreadcrumb />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a single breadcrumb as a page (not a link)", () => {
    mockUseMatches.mockReturnValue([makeMatch("/", "Overview")]);
    const { container } = render(<DashboardBreadcrumb />);

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(
      screen.getByText("Overview").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
    expect(screen.getByText("Overview").closest("a")).toBeNull();
    expect(container.querySelectorAll("[data-slot='breadcrumb-separator']")).toHaveLength(0);
  });

  it("renders multiple breadcrumbs with links and a final page", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/runs", "Runs"),
      makeMatch("/runs/$traceId", "My Workflow", {
        params: { traceId: "abc123" },
      }),
    ]);
    const { container } = render(<DashboardBreadcrumb />);

    const runsLink = screen.getByText("Runs").closest("a");
    expect(runsLink).toHaveAttribute("href", "/runs");

    expect(
      screen.getByText("My Workflow").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-slot='breadcrumb-separator']")).toHaveLength(1);
  });

  it("evaluates function breadcrumbs with match data", () => {
    const breadcrumbFn = (match: Record<string, unknown>) => {
      const loaderData = match.loaderData as { runDetails?: { workflowName?: string } } | undefined;
      return loaderData?.runDetails?.workflowName ?? "Run Details";
    };

    mockUseMatches.mockReturnValue([
      makeMatch("/runs", "Runs"),
      makeMatch("/runs/$traceId", breadcrumbFn, {
        params: { traceId: "abc123" },
        loaderData: { runDetails: { workflowName: "CI Build" } },
      }),
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("CI Build")).toBeInTheDocument();
  });

  it("filters out matches without staticData.breadcrumb", () => {
    mockUseMatches.mockReturnValue([
      { fullPath: "/", staticData: {} },
      makeMatch("/runs", "Runs"),
      { fullPath: "/runs/abc123/jobs/1", staticData: {} },
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("Runs").closest("[data-slot='breadcrumb-page']")).toBeInTheDocument();
  });

  it("filters out crumbs where function returns empty string", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/runs", "Runs"),
      makeMatch("/runs/$traceId", () => "", {
        params: { traceId: "abc123" },
      }),
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(screen.getByText("Runs").closest("[data-slot='breadcrumb-page']")).toBeInTheDocument();
  });

  it("applies hidden md:block class to non-last items for responsive behavior", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/runs", "Runs"),
      makeMatch("/runs/$traceId", "My Workflow", {
        params: { traceId: "abc123" },
      }),
    ]);
    const { container } = render(<DashboardBreadcrumb />);

    const items = container.querySelectorAll("[data-slot='breadcrumb-item']");
    expect(items).toHaveLength(2);
    expect(items[0].className).toContain("hidden md:block");
    expect(items[1].className).not.toContain("hidden md:block");
  });

  it("renders multi-segment breadcrumbs from array return", () => {
    const segmentsFn = () =>
      [
        {
          label: "Dashboards",
          link: <Link to="/dashboards" search={{ preview: "published" }} />,
        },
        {
          label: "my-proj",
          link: (
            <Link
              to="/runbooks/$project/$slug"
              params={{ project: "my-proj", slug: "overview" }}
              search={(prev) => ({ ...prev, preview: "draft" })}
            />
          ),
        },
        { label: "Overview" },
      ] satisfies BreadcrumbSegment[];

    mockUseMatches.mockReturnValue([
      makeMatch("/runbooks/$project/$slug", segmentsFn, {
        params: { project: "my-proj", slug: "overview" },
      }),
    ]);
    const { container } = render(<DashboardBreadcrumb />);

    // First two are links, last is a page
    const rootLink = screen.getByText("Dashboards").closest("a");
    expect(rootLink).toHaveAttribute("href", "/dashboards?preview=published");

    const pkgLink = screen.getByText("my-proj").closest("a");
    expect(pkgLink).toHaveAttribute(
      "href",
      "/runbooks/my-proj/overview?keep=current&preview=draft",
    );

    expect(
      screen.getByText("Overview").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-slot='breadcrumb-separator']")).toHaveLength(2);
  });
});
