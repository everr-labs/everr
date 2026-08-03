// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { FilterCombobox } from "./filter-combobox";

function renderCombobox({
  items = [] as string[],
  values = [] as string[],
  onChange = vi.fn(),
  allowCustom = false,
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryFn = vi.fn().mockResolvedValue(items);

  function Harness() {
    const [current, setCurrent] = useState(values);
    return (
      <FilterCombobox
        label="Equal labels"
        values={current}
        onChange={(next) => {
          setCurrent(next);
          onChange(next);
        }}
        options={{
          queryKey: ["filter-test"],
          queryFn,
          select: (data: string[]) => data,
        }}
        placeholder="Any labels"
        allowCustom={allowCustom}
      />
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { queryFn, onChange };
}

it("adds a typed custom entry to the selection via the Use row", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox({
    items: ["cluster"],
    allowCustom: true,
  });

  await user.click(screen.getByRole("combobox", { name: "Equal labels" }));
  await user.type(screen.getByPlaceholderText("Search..."), "namespace");
  await user.click(screen.getByText('"namespace"'));

  expect(onChange).toHaveBeenCalledWith(["namespace"]);
});

it("lists selected values the query did not return as checked rows", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox({
    items: ["cluster"],
    values: ["cluster", "namespace"],
    allowCustom: true,
  });

  await user.click(screen.getByRole("combobox", { name: "Equal labels" }));
  const row = await screen.findByRole("option", { name: "namespace" });
  await user.click(row);
  expect(onChange).toHaveBeenCalledWith(["cluster"]);
});
