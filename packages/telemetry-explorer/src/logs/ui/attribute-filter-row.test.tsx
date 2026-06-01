import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogsRepositoryLike } from "../data/repository";
import type { AttributeFilter, AttributeOp } from "../schemas";
import { AttributeFilterRow } from "./attribute-filter-row";

const repo = {} as LogsRepositoryLike;
const timeRange = { from: "now-1h", to: "now" };

function renderRow(op: AttributeOp) {
  const filter: AttributeFilter = {
    source: "resource",
    key: "deployment.environment",
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
