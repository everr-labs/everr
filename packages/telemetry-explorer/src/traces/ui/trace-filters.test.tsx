import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TracesRepositoryLike } from "../data/repository";
import { TraceFilters } from "./trace-filters";

function makeRepo(): TracesRepositoryLike {
  return {
    attributeKeys: vi.fn().mockResolvedValue([]),
    attributeValues: vi.fn().mockResolvedValue([]),
  } as unknown as TracesRepositoryLike;
}

const defaultTimeRange = { from: "now-1h", to: "now" } as const;

const defaultValue = {
  namespace: [],
  name: "",
  minMs: undefined,
  maxMs: undefined,
  status: "all" as const,
  attributes: [],
};

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
}

describe("TraceFilters rail", () => {
  it("renders Search, Status, Namespace, Duration and the attribute section", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "Trace filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Namespace")).toBeInTheDocument();
    expect(screen.getByText("Min ms")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("renders the span-name search inside the rail", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    const rail = screen.getByRole("complementary", { name: "Trace filters" });
    expect(rail).toContainElement(
      screen.getByPlaceholderText("Filter by span name"),
    );
  });

  it("never renders Service or Environment: those belong to the persistent zone", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[{ serviceNamespace: "", serviceName: "web" }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Service")).not.toBeInTheDocument();
    expect(screen.queryByText("Environment")).not.toBeInTheDocument();
  });

  it("renders the persistent zone above the page filters when given one", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        persistentFilters={<div>persistent zone</div>}
        onChange={vi.fn()}
      />,
    );
    const rail = screen.getByRole("complementary", { name: "Trace filters" });
    const zone = screen.getByText("persistent zone");
    const status = screen.getByText("Status");
    expect(rail).toContainElement(zone);
    // Node.compareDocumentPosition returns 4 when zone comes before status.
    expect(zone.compareDocumentPosition(status)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("shows a legacy deployment.environment attribute as a removable pill", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={{
          ...defaultValue,
          attributes: [
            {
              source: "resource",
              key: "deployment.environment",
              op: "in",
              values: ["prod"],
            },
          ],
        }}
        identities={[]}
        onChange={vi.fn()}
      />,
    );
    // The top zone of the rail sets Environment, and it writes its own search
    // param. An older entry, for example from a saved link, must stay visible
    // and the user must be able to remove it. The query still applies that
    // entry, so a hidden entry narrows the results for no visible reason.
    expect(
      screen.getByRole("button", { name: "Remove Environment filter" }),
    ).toBeInTheDocument();
  });

  it("clear resets the page zone, including the search text", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={{ ...defaultValue, status: "error", name: "checkout" }}
        identities={[]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    expect(onChange).toHaveBeenCalledWith({
      namespace: [],
      name: "",
      minMs: undefined,
      maxMs: undefined,
      status: "all",
      attributes: [],
    });
  });

  it("clear never touches the persistent filters", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={{ ...defaultValue, status: "error" }}
        identities={[]}
        persistentFilterCount={2}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("service");
    expect(patch).not.toHaveProperty("environment");
  });

  it("an active persistent filter alone does not surface the clear control", () => {
    renderWithQueryClient(
      <TraceFilters
        repo={makeRepo()}
        timeRange={defaultTimeRange}
        value={defaultValue}
        identities={[]}
        persistentFilterCount={2}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear page filters" }),
    ).not.toBeInTheDocument();
  });
});
