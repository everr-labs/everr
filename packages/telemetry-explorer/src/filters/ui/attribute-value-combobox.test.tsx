import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AttributeRepositoryLike } from "../../attribute-filter/repository";
import type { AttributeFilter } from "../../attribute-filter/schemas";
import { AttributeValueCombobox } from "./attribute-value-combobox";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

const repo = {
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
} as unknown as AttributeRepositoryLike;

function setup(attributes: AttributeFilter[], onChange = vi.fn()) {
  renderWithQueryClient(
    <AttributeValueCombobox
      repo={repo}
      domain="logs"
      timeRange={{ from: "now-1h", to: "now" }}
      source="resource"
      attributeKey="deployment.environment"
      label="Environment"
      placeholder="All environments"
      attributes={attributes}
      onChange={onChange}
    />,
  );
  return onChange;
}

describe("AttributeValueCombobox", () => {
  it("renders its label", () => {
    setup([]);
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("shows the selected count badge from the matching 'in' entry", () => {
    setup([
      {
        source: "resource",
        key: "deployment.environment",
        op: "in",
        values: ["prod", "staging"],
      },
    ]);
    // FilterCombobox shows the first value plus a "+N" badge for the rest.
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("+1")).toBeInTheDocument();
  });
});
