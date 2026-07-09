// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { SuggestCombobox, type SuggestItem } from "./suggest-combobox";

function renderCombobox({
  items = [] as SuggestItem[],
  value = "",
  onChange = vi.fn(),
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryFn = vi.fn().mockResolvedValue(items);

  function Harness() {
    const [current, setCurrent] = useState(value);
    return (
      <SuggestCombobox
        label="Matcher value"
        value={current}
        onChange={(next) => {
          setCurrent(next);
          onChange(next);
        }}
        options={{
          queryKey: ["suggest-test"],
          queryFn,
          select: (data: SuggestItem[]) => data,
        }}
        placeholder="value"
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

it("loads suggestions only once opened and renders hint and tag", async () => {
  const user = userEvent.setup();
  const { queryFn } = renderCombobox({
    items: [
      { value: "severity", tag: "synthetic" },
      { value: "rule-1", hint: "High 5xx rate" },
    ],
  });

  // Closed: nothing fetched, so suggestions can never block typing elsewhere.
  expect(queryFn).not.toHaveBeenCalled();

  await user.click(screen.getByRole("combobox", { name: "Matcher value" }));

  expect(await screen.findByText("severity")).toBeInTheDocument();
  expect(screen.getByText("synthetic")).toBeInTheDocument();
  expect(screen.getByText("rule-1")).toBeInTheDocument();
  expect(screen.getByText("High 5xx rate")).toBeInTheDocument();
  expect(queryFn).toHaveBeenCalledTimes(1);
});

it("commits a selected suggestion and closes", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox({
    items: [{ value: "critical" }, { value: "warning" }],
  });

  await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
  await user.click(await screen.findByText("critical"));

  expect(onChange).toHaveBeenCalledWith("critical");
  const trigger = screen.getByRole("combobox", { name: "Matcher value" });
  expect(trigger).toHaveTextContent("critical");
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("offers a Use row for typed text that matches no suggestion", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox({ items: [{ value: "critical" }] });

  await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
  await user.type(
    screen.getByPlaceholderText("Search or type..."),
    "custom-thing",
  );
  await user.click(screen.getByText('"custom-thing"'));

  expect(onChange).toHaveBeenCalledWith("custom-thing");
  expect(
    screen.getByRole("combobox", { name: "Matcher value" }),
  ).toHaveTextContent("custom-thing");
});

it("hides the Use row when the typed text duplicates a suggestion", async () => {
  const user = userEvent.setup();
  renderCombobox({ items: [{ value: "critical" }] });

  await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
  await screen.findByText("critical");
  await user.type(screen.getByPlaceholderText("Search or type..."), "critical");

  expect(screen.queryByText("Use")).not.toBeInTheDocument();
  expect(screen.getByText("critical")).toBeInTheDocument();
});
