import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
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

import { ChildrenTable } from "./children-table";

function renderWithProviders(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("ChildrenTable", () => {
  it("uses suite icon and pkg navigation at root level", () => {
    const { container } = renderWithProviders(
      <ChildrenTable
        data={[
          {
            name: "my-pkg",
            isSuite: true,
            executions: 10,
            avgDuration: 1.2,
            p95Duration: 2.3,
            failureRate: 5,
          },
        ]}
        timeRange={{ from: "-7d", to: "now" }}
      />,
    );

    const link = screen.getByText("my-pkg").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/test-performance?pkg=my-pkg",
    );
    expect(container.querySelector("svg.lucide-folder-open")).toBeTruthy();
  });

  it("uses leaf icon and path navigation for test rows", () => {
    const { container } = renderWithProviders(
      <ChildrenTable
        pkg="my-pkg"
        data={[
          {
            name: "my-pkg > Describe > test",
            isSuite: false,
            executions: 10,
            avgDuration: 1.2,
            p95Duration: 2.3,
            failureRate: 5,
          },
        ]}
        timeRange={{ from: "-7d", to: "now" }}
      />,
    );

    const link = screen.getByText("test").closest("a");
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/test-performance?pkg=my-pkg&path=my-pkg+%3E+Describe+%3E+test",
    );
    expect(container.querySelector("svg.lucide-flask-conical")).toBeTruthy();
  });
});
