import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter } from "../schemas";
import { AttributeFilterPill } from "./attribute-filter-pill";

const timeRange = { from: "now-1h", to: "now" };

function renderPill(
  filter: AttributeFilter,
  opts: { defaultOpen?: boolean } = {},
) {
  const repo = {
    attributeValues: vi.fn().mockResolvedValue(["production", "staging"]),
  } as unknown as LogsRepositoryLike;
  const onChange = vi.fn();
  const onRemove = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeFilterPill
        repo={repo}
        timeRange={timeRange}
        filter={filter}
        defaultOpen={opts.defaultOpen}
        onChange={onChange}
        onRemove={onRemove}
      />
    </QueryClientProvider>,
  );
  return { onChange, onRemove };
}

const baseFilter: AttributeFilter = {
  source: "resource",
  key: "deployment.environment",
  op: "in",
  values: [],
};

describe("AttributeFilterPill display", () => {
  it("shows friendly name, connector, and 'any value' for a pending in-filter", () => {
    renderPill(baseFilter);
    expect(screen.getByText("Environment")).toBeInTheDocument();
    expect(screen.getByText("is")).toBeInTheDocument();
    expect(screen.getByText("any value")).toBeInTheDocument();
  });

  it("summarizes selected values with an overflow count", () => {
    renderPill({ ...baseFilter, values: ["production", "staging"] });
    expect(screen.getByText("production +1")).toBeInTheDocument();
  });

  it("shows the connector with no value summary for exists", () => {
    renderPill({ ...baseFilter, op: "exists" });
    expect(screen.getByText("exists")).toBeInTheDocument();
    expect(screen.queryByText("any value")).not.toBeInTheDocument();
  });

  it("falls back to the raw key for an unknown attribute", () => {
    renderPill({ ...baseFilter, key: "custom.unknown.thing" });
    expect(screen.getByText("custom.unknown.thing")).toBeInTheDocument();
  });

  it("exposes the raw attribute key as a hover title", () => {
    renderPill(baseFilter);
    expect(screen.getByTitle("deployment.environment")).toBeInTheDocument();
  });

  it("removes the filter when the remove button is clicked", () => {
    const { onRemove } = renderPill(baseFilter);
    fireEvent.click(screen.getByLabelText("Remove Environment filter"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe("AttributeFilterPill editor", () => {
  it("opens the editor on click and lists every op as a readable label", () => {
    renderPill(baseFilter);
    fireEvent.click(screen.getByText("Environment"));
    // Op segmented control shows human labels, not raw keys.
    expect(screen.getByText("Is not")).toBeInTheDocument();
    expect(screen.getByText("Exists")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("shows the value picker for in/not_in and loads discovered values", async () => {
    renderPill(baseFilter, { defaultOpen: true });
    expect(screen.getByPlaceholderText("Search values...")).toBeInTheDocument();
    expect(await screen.findByText("production")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
  });

  it("hides the value picker for exists/missing", () => {
    renderPill({ ...baseFilter, op: "missing" }, { defaultOpen: true });
    expect(
      screen.queryByPlaceholderText("Search values..."),
    ).not.toBeInTheDocument();
  });

  it("changes the op when an op button is clicked", () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    fireEvent.click(screen.getByText("Is not"));
    expect(onChange).toHaveBeenCalledWith({ ...baseFilter, op: "not_in" });
  });

  it("toggles a value when picked", async () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    fireEvent.click(await screen.findByText("production"));
    expect(onChange).toHaveBeenCalledWith({
      ...baseFilter,
      values: ["production"],
    });
  });
});
