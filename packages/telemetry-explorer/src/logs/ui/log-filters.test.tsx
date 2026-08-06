import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import { LogFiltersBar } from "./log-filters";

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
  filterOptions: vi.fn().mockResolvedValue({ services: [] }),
} as unknown as LogsRepositoryLike;

const baseProps = {
  repo,
  timeRange: { from: "now-1h", to: "now" } as const,
  q: "",
  levels: [],
  attributes: [],
  traceId: undefined,
};

describe("LogFiltersBar", () => {
  it("renders Search, Severity, Trace and the attribute section in the rail", () => {
    renderWithQueryClient(<LogFiltersBar {...baseProps} onChange={vi.fn()} />);
    expect(
      screen.getByRole("complementary", { name: "Log filters" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Severity")).toBeInTheDocument();
    expect(screen.getByText("Trace")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
  });

  it("never renders Service or Environment: those belong to the persistent zone", () => {
    renderWithQueryClient(<LogFiltersBar {...baseProps} onChange={vi.fn()} />);
    expect(screen.queryByText("Service")).not.toBeInTheDocument();
    expect(screen.queryByText("Environment")).not.toBeInTheDocument();
  });

  it("renders the message search inside the rail", () => {
    renderWithQueryClient(<LogFiltersBar {...baseProps} onChange={vi.fn()} />);
    const rail = screen.getByRole("complementary", { name: "Log filters" });
    expect(rail).toContainElement(
      screen.getByPlaceholderText("Search messages, errors, IDs"),
    );
  });

  it("clear resets the search, levels, attributes and trace id", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        q="timeout"
        levels={["error"]}
        attributes={[
          {
            source: "resource",
            key: "deployment.environment",
            op: "in",
            values: ["prod"],
          },
        ]}
        traceId="abc"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    // q clears to undefined and not to "". The rail sends the same shape as the
    // search param, so an empty search stays out of the URL.
    expect(onChange).toHaveBeenCalledWith({
      q: undefined,
      levels: [],
      attributes: [],
      traceId: undefined,
    });
  });

  it("clear never touches the persistent filters", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        levels={["error"]}
        persistentFilterCount={2}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("services");
    expect(patch).not.toHaveProperty("environment");
  });

  it("an active persistent filter alone does not surface the clear control", () => {
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        persistentFilterCount={2}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Clear page filters" }),
    ).not.toBeInTheDocument();
  });

  it("shows a legacy deployment.environment attribute as a removable pill", () => {
    // The top zone of the rail sets Environment, and it writes its own search
    // param. An older entry, for example from a saved link, must stay visible
    // and the user must be able to remove it. The query still applies that
    // entry, so a hidden entry narrows the results for no visible reason.
    renderWithQueryClient(
      <LogFiltersBar
        {...baseProps}
        attributes={[
          {
            source: "resource",
            key: "deployment.environment",
            op: "in",
            values: ["prod"],
          },
        ]}
        onChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Remove Environment filter" }),
    ).toBeInTheDocument();
  });

  it("syncs the Trace input when the traceId prop is cleared externally", () => {
    // Regression: the Trace input held a local draft seeded once from traceId.
    // When another control clears traceId, for example "Clear page filters" or
    // a link, the input must clear too. If it does not, it shows an old id and
    // applies that id again on Enter.
    const { rerender } = renderWithQueryClient(
      <LogFiltersBar {...baseProps} traceId="abc123" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText("Trace") as HTMLInputElement;
    expect(input.value).toBe("abc123");

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LogFiltersBar {...baseProps} traceId={undefined} onChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect((screen.getByLabelText("Trace") as HTMLInputElement).value).toBe("");
  });
});
