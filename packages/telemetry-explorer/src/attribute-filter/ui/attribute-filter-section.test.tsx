import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter, AttributeSource } from "../schemas";
import { AttributeFilterSection } from "./attribute-filter-section";
import type { PromotedAttribute } from "./attribute-meta";

const timeRange = { from: "now-1h", to: "now" };
const PROMOTED: PromotedAttribute[] = [];
const EXCLUDED = new Set<string>();
const SOURCES: AttributeSource[] = ["resource", "log", "scope"];

function setup(attributes: AttributeFilter[]) {
  const repo = {
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as AttributeRepositoryLike;
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeFilterSection
        repo={repo}
        domain="logs"
        timeRange={timeRange}
        attributes={attributes}
        promotedAttributes={PROMOTED}
        excludedKeys={EXCLUDED}
        sources={SOURCES}
        onChange={onChange}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("AttributeFilterSection", () => {
  it("renders the header and the add-filter trigger", () => {
    setup([]);
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getByText("Filter")).toBeInTheDocument();
  });

  it("renders a pill per active filter", () => {
    setup([
      {
        source: "resource",
        key: "deployment.environment",
        op: "in",
        values: [],
      },
    ]);
    expect(screen.getByText("Environment")).toBeInTheDocument();
  });

  it("removes a filter via its pill", () => {
    const { onChange } = setup([
      {
        source: "resource",
        key: "deployment.environment",
        op: "in",
        values: [],
      },
    ]);
    fireEvent.click(screen.getByLabelText("Remove Environment filter"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
