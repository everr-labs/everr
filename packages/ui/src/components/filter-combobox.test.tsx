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

it("offers no Use row without allowCustom", async () => {
  const user = userEvent.setup();
  renderCombobox({ items: ["cluster"] });

  await user.click(screen.getByRole("combobox", { name: "Equal labels" }));
  await screen.findByText("cluster");
  await user.type(screen.getByPlaceholderText("Search..."), "namespace");

  expect(screen.queryByText("Use")).not.toBeInTheDocument();
});

it("lists selected values the query did not return as checked rows", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox({
    items: ["cluster"],
    values: ["cluster", "namespace"],
    allowCustom: true,
  });

  await user.click(screen.getByRole("combobox", { name: "Equal labels" }));
  // The custom selection gets its own checked row alongside the loaded item,
  // so it can be toggled off directly instead of hiding behind the +N badge.
  const row = await screen.findByRole("option", { name: "namespace" });
  expect(row).toHaveAttribute("data-checked");

  await user.click(row);
  expect(onChange).toHaveBeenCalledWith(["cluster"]);
});

it("hides the Use row when the typed text is already selected or listed", async () => {
  const user = userEvent.setup();
  renderCombobox({
    items: ["cluster"],
    values: ["namespace"],
    allowCustom: true,
  });

  const search = () => screen.getByPlaceholderText("Search...");
  await user.click(screen.getByRole("combobox", { name: "Equal labels" }));
  await screen.findByText("cluster");

  await user.type(search(), "cluster");
  expect(screen.queryByText("Use")).not.toBeInTheDocument();

  await user.clear(search());
  await user.type(search(), "namespace");
  expect(screen.queryByText("Use")).not.toBeInTheDocument();
});
