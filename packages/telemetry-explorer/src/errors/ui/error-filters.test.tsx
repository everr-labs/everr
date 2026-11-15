import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ErrorsRepositoryLike } from "../data/repository";
import { ErrorFilters } from "./error-filters";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const repo = {
  attributeKeys: vi.fn().mockResolvedValue([]),
  attributeValues: vi.fn().mockResolvedValue([]),
} as unknown as ErrorsRepositoryLike;

const baseValue = {
  q: "",
  service: [] as string[],
  fingerprint: "",
  sort: "lastSeen" as const,
  attributes: [],
  withRecording: false,
};

describe("ErrorFilters", () => {
  it("renders Search, Order and the attribute section in the rail, and emits sort changes", async () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={baseValue}
        recordingFilter={false}
        onChange={onChange}
      />,
    );
    const rail = screen.getByRole("complementary", { name: "Error filters" });
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Order")).toBeInTheDocument();
    expect(screen.getByText("Attributes")).toBeInTheDocument();
    expect(rail).toContainElement(screen.getByPlaceholderText("Search errors"));
    // Service and Environment belong to the persistent zone.
    expect(screen.queryByText("Service")).not.toBeInTheDocument();
    expect(screen.queryByText("Environment")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(onChange).toHaveBeenCalledWith({ sort: "count" });
  });

  it("clear resets the search and attributes but not the sort order", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{
          ...baseValue,
          q: "TypeError",
          sort: "count",
          attributes: [
            {
              source: "resource",
              key: "deployment.environment.name",
              op: "in",
              values: ["prod"],
            },
          ],
        }}
        recordingFilter={false}
        onChange={onChange}
      />,
    );
    // The top zone of the rail sets Environment, and it writes its own search
    // param. An older entry, for example from a saved link, must stay visible
    // and the user must be able to remove it. The query still applies that
    // entry, so a hidden entry narrows the results for no visible reason.
    expect(screen.getByRole("button", { name: "Remove Environment filter" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    expect(onChange).toHaveBeenCalledWith({ q: "", attributes: [], withRecording: false });
  });

  it("clear never touches the persistent filters", () => {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{ ...baseValue, q: "TypeError" }}
        persistentFilterCount={1}
        recordingFilter={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    const patch = onChange.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("service");
    expect(patch).not.toHaveProperty("environment");
  });

  it.each([
    ["an active persistent filter", { value: baseValue, persistentFilterCount: 1 }],
    ["the sort control", { value: { ...baseValue, sort: "count" as const } }],
  ])("%s alone does not surface the clear control", (_, props) => {
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        recordingFilter={false}
        onChange={vi.fn()}
        {...props}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear page filters" })).not.toBeInTheDocument();
  });
});

describe("ErrorFilters session recording switch", () => {
  function renderRail(props: { recordingFilter: boolean; withRecording?: boolean }) {
    const onChange = vi.fn();
    renderWithQueryClient(
      <ErrorFilters
        repo={repo}
        timeRange={{ from: "now-1h", to: "now" }}
        value={{ ...baseValue, withRecording: props.withRecording ?? false }}
        recordingFilter={props.recordingFilter}
        onChange={onChange}
      />,
    );
    return onChange;
  }

  it("is drawn only where the host has session recordings", () => {
    renderRail({ recordingFilter: false });
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("turns the filter on", () => {
    const onChange = renderRail({ recordingFilter: true });
    const toggle = screen.getByRole("switch", { name: "With session recording" });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ withRecording: true });
  });

  it("counts as a page filter and is reset by Clear page filters", () => {
    const onChange = renderRail({ recordingFilter: true, withRecording: true });
    expect(screen.getByRole("switch", { name: "With session recording" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Clear page filters" }));
    expect(onChange).toHaveBeenCalledWith({ q: "", attributes: [], withRecording: false });
  });
});
