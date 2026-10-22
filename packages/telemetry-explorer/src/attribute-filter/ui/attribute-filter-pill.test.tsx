import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AttributeRepositoryLike } from "../repository";
import type { AttributeFilter } from "../schemas";
import { AttributeFilterPill } from "./attribute-filter-pill";

const timeRange = { from: "now-1h", to: "now" };

function renderPill(filter: AttributeFilter, opts: { defaultOpen?: boolean } = {}) {
  const repo = {
    attributeValues: vi.fn().mockResolvedValue(["production", "staging"]),
  } as unknown as AttributeRepositoryLike;
  const onChange = vi.fn();
  const onRemove = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AttributeFilterPill
        repo={repo}
        domain="logs"
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

describe("AttributeFilterPill", () => {
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

  it("opens the editor and lists readable op labels", () => {
    renderPill(baseFilter);
    fireEvent.click(screen.getByText("Environment"));
    expect(screen.getByText("Is not")).toBeInTheDocument();
    expect(screen.getByText("Exists")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("loads and toggles discovered values for in/not_in", async () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    expect(screen.getByPlaceholderText("Search values...")).toBeInTheDocument();
    fireEvent.click(await screen.findByText("production"));
    expect(onChange).toHaveBeenCalledWith({
      ...baseFilter,
      values: ["production"],
    });
  });

  it("hides the value picker for exists/missing", () => {
    renderPill({ ...baseFilter, op: "missing" }, { defaultOpen: true });
    expect(screen.queryByPlaceholderText("Search values...")).not.toBeInTheDocument();
  });

  it("changes the op when an op button is clicked", () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    fireEvent.click(screen.getByText("Is not"));
    expect(onChange).toHaveBeenCalledWith({ ...baseFilter, op: "not_in" });
  });

  it("offers a free-text 'use exactly' entry for a value past the cutoff", () => {
    const { onChange } = renderPill(baseFilter, { defaultOpen: true });
    fireEvent.change(screen.getByPlaceholderText("Search values..."), {
      target: { value: "us-east-1a" },
    });
    fireEvent.click(screen.getByText(/Use exactly/));
    expect(onChange).toHaveBeenCalledWith({
      ...baseFilter,
      values: ["us-east-1a"],
    });
  });

  it("keeps an already-selected value visible even if discovery omits it", () => {
    renderPill({ ...baseFilter, values: ["legacy-value"] }, { defaultOpen: true });
    // Discovery mock returns production/staging; the selected value must remain
    // a selectable (checked) option so it can be deselected.
    expect(screen.getByRole("option", { name: "legacy-value" })).toBeInTheDocument();
  });
});
