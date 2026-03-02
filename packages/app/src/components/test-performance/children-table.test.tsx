import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
  it("uses suite icon and renders package name at root level", () => {
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

    expect(screen.getByText("my-pkg")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-folder-open")).toBeTruthy();
  });

  it("uses leaf icon and renders last segment for test rows", () => {
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

    expect(screen.getByText("test")).toBeInTheDocument();
    expect(container.querySelector("svg.lucide-flask-conical")).toBeTruthy();
  });
});
