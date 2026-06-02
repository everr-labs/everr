import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ErrorsRepositoryLike } from "../data/repository";
import { ErrorFilters } from "./error-filters";

describe("ErrorFilters", () => {
  it("renders the attribute section alongside the service filter", () => {
    const repo = {
      attributeKeys: vi.fn().mockResolvedValue([]),
      attributeValues: vi.fn().mockResolvedValue([]),
    } as unknown as ErrorsRepositoryLike;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ErrorFilters
          repo={repo}
          timeRange={{ from: "now-1h", to: "now" }}
          value={{
            q: "",
            service: [],
            fingerprint: "",
            sort: "lastSeen",
            attributes: [],
          }}
          services={[]}
          onChange={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(screen.getAllByText("Filter").length).toBeGreaterThan(0);
  });
});
