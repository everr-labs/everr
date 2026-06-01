import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, AttributeOp } from "../schemas";
import { AttributeFilterRow } from "./attribute-filter-row";

const repo = {} as LogsRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

function renderRow(op: AttributeOp, key = "deployment.environment") {
  const filter: AttributeFilter = {
    source: "resource",
    key,
    op,
    values: [],
  };
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AttributeFilterRow
        repo={repo}
        timeRange={timeRange}
        filter={filter}
        onChange={() => {}}
        onRemove={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("AttributeFilterRow op select trigger", () => {
  // Regression: base-ui Select.Value renders the raw value ("in") unless given a
  // formatter; the trigger must show the human label, not the op key.
  it.each([
    ["in", "Is"],
    ["not_in", "Is not"],
    ["exists", "Exists"],
    ["missing", "Missing"],
  ] as const)("renders op %s as label %s", (op, label) => {
    const { container } = renderRow(op);
    const value = container.querySelector('[data-slot="select-value"]');
    expect(value?.textContent).toBe(label);
  });
});

describe("AttributeFilterRow key header", () => {
  it("shows the friendly name and the raw key for a known attribute", () => {
    const { getByText } = renderRow("exists", "deployment.environment");
    expect(getByText("Environment")).toBeInTheDocument();
    expect(getByText("deployment.environment")).toBeInTheDocument();
  });

  it("shows only the raw key for an unknown attribute", () => {
    const { getByText, queryByText } = renderRow(
      "exists",
      "custom.unknown.thing",
    );
    expect(getByText("custom.unknown.thing")).toBeInTheDocument();
    // No friendly label is rendered for an unknown key.
    expect(queryByText("Environment")).not.toBeInTheDocument();
  });
});
