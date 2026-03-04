import { render, screen } from "@testing-library/react";
import { describe, expect, it, type Mock, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useMatches: vi.fn(),
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: (prev: Record<string, unknown>) => Record<string, unknown>;
    children?: React.ReactNode;
  }) => {
    const resolvedSearch = search ? search({}) : undefined;
    const searchStr = resolvedSearch
      ? `?${new URLSearchParams(
          Object.entries(resolvedSearch)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()}`
      : "";
    return <a href={`${to}${searchStr}`}>{children}</a>;
  },
}));

import { useMatches } from "@tanstack/react-router";
import type { BreadcrumbSegment } from "@/router-types";
import { DashboardBreadcrumb } from "./dashboard-breadcrumb";

const mockUseMatches = useMatches as Mock;

function makeMatch(
  fullPath: string,
  breadcrumb?:
    | string
    | ((
        match: Record<string, unknown>,
      ) => string | BreadcrumbSegment[] | undefined),
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
    mockUseMatches.mockReturnValue([
      { fullPath: "/dashboard", staticData: {} },
    ]);
    const { container } = render(<DashboardBreadcrumb />);
    expect(container.innerHTML).toBe("");
  });

  it("renders a single breadcrumb as a page (not a link)", () => {
    mockUseMatches.mockReturnValue([makeMatch("/dashboard", "Overview")]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(
      screen.getByText("Overview").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
    expect(screen.getByText("Overview").closest("a")).toBeNull();
  });

  it("renders multiple breadcrumbs with links and a final page", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/runs", "Runs"),
      makeMatch("/dashboard/runs/abc123", "My Workflow"),
    ]);
    render(<DashboardBreadcrumb />);

    const runsLink = screen.getByText("Runs").closest("a");
    expect(runsLink).toHaveAttribute("href", "/dashboard/runs");

    expect(
      screen.getByText("My Workflow").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
  });

  it("renders separators only between breadcrumbs", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/runs", "Runs"),
      makeMatch("/dashboard/runs/abc123", "My Workflow"),
    ]);
    const { container } = render(<DashboardBreadcrumb />);

    const separators = container.querySelectorAll(
      "[data-slot='breadcrumb-separator']",
    );
    expect(separators).toHaveLength(1);
  });

  it("has no separators for a single breadcrumb", () => {
    mockUseMatches.mockReturnValue([makeMatch("/dashboard", "Overview")]);
    const { container } = render(<DashboardBreadcrumb />);

    const separators = container.querySelectorAll(
      "[data-slot='breadcrumb-separator']",
    );
    expect(separators).toHaveLength(0);
  });

  it("evaluates function breadcrumbs with match data", () => {
    const breadcrumbFn = (match: Record<string, unknown>) => {
      const loaderData = match.loaderData as
        | { runDetails?: { workflowName?: string } }
        | undefined;
      return loaderData?.runDetails?.workflowName ?? "Run Details";
    };

    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/runs", "Runs"),
      makeMatch("/dashboard/runs/abc123", breadcrumbFn, {
        loaderData: { runDetails: { workflowName: "CI Build" } },
      }),
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("CI Build")).toBeInTheDocument();
  });

  it("uses fallback when function breadcrumb has no loader data", () => {
    const breadcrumbFn = (match: Record<string, unknown>) => {
      const loaderData = match.loaderData as
        | { runDetails?: { workflowName?: string } }
        | undefined;
      return loaderData?.runDetails?.workflowName ?? "Run Details";
    };

    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/runs/abc123", breadcrumbFn, {
        loaderData: undefined,
      }),
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("Run Details")).toBeInTheDocument();
  });

  it("filters out matches without staticData.breadcrumb", () => {
    mockUseMatches.mockReturnValue([
      { fullPath: "/dashboard", staticData: {} },
      makeMatch("/dashboard/runs", "Runs"),
      { fullPath: "/dashboard/runs/abc123/jobs/1", staticData: {} },
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(
      screen.getByText("Runs").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
  });

  it("filters out crumbs where function returns empty string", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/runs", "Runs"),
      makeMatch("/dashboard/runs/abc123", () => ""),
    ]);
    render(<DashboardBreadcrumb />);

    expect(screen.getByText("Runs")).toBeInTheDocument();
    expect(
      screen.getByText("Runs").closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
  });

  it("applies hidden md:block class to non-last items for responsive behavior", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/runs", "Runs"),
      makeMatch("/dashboard/runs/abc123", "My Workflow"),
    ]);
    const { container } = render(<DashboardBreadcrumb />);

    const items = container.querySelectorAll("[data-slot='breadcrumb-item']");
    expect(items).toHaveLength(2);
    expect(items[0].className).toContain("hidden md:block");
    expect(items[1].className).not.toContain("hidden md:block");
  });

  it("renders parent and leaf breadcrumbs correctly", () => {
    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/workflows", "Workflows"),
      makeMatch("/dashboard/tests-overview", "Tests Overview"),
    ]);
    render(<DashboardBreadcrumb />);

    const parentLink = screen.getByText("Workflows").closest("a");
    expect(parentLink).toHaveAttribute("href", "/dashboard/workflows");

    expect(
      screen
        .getByText("Tests Overview")
        .closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
  });

  it("renders multi-segment breadcrumbs from array return", () => {
    const segmentsFn = () =>
      [
        { label: "Tests Overview", search: {} },
        { label: "my-pkg", search: { pkg: "my-pkg" } },
        {
          label: "TraceWaterfall",
          search: { pkg: "my-pkg", path: "my-pkg > TraceWaterfall" },
        },
      ] as BreadcrumbSegment[];

    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/tests-overview", segmentsFn),
    ]);
    render(<DashboardBreadcrumb />);

    // First two are links, last is a page
    const rootLink = screen.getByText("Tests Overview").closest("a");
    expect(rootLink).toHaveAttribute("href", "/dashboard/tests-overview?");

    const pkgLink = screen.getByText("my-pkg").closest("a");
    expect(pkgLink).toHaveAttribute(
      "href",
      "/dashboard/tests-overview?pkg=my-pkg",
    );

    expect(
      screen
        .getByText("TraceWaterfall")
        .closest("[data-slot='breadcrumb-page']"),
    ).toBeInTheDocument();
  });

  it("renders separators between multi-segment crumbs", () => {
    const segmentsFn = () =>
      [
        { label: "Tests Overview", search: {} },
        { label: "pkg", search: { pkg: "pkg" } },
        { label: "Describe", search: { pkg: "pkg", path: "pkg > Describe" } },
      ] as BreadcrumbSegment[];

    mockUseMatches.mockReturnValue([
      makeMatch("/dashboard/tests-overview", segmentsFn),
    ]);
    const { container } = render(<DashboardBreadcrumb />);

    const separators = container.querySelectorAll(
      "[data-slot='breadcrumb-separator']",
    );
    expect(separators).toHaveLength(2);
  });
});
