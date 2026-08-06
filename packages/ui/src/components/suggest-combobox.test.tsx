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
  displayValue,
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
        displayValue={displayValue}
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

it("loads suggestions only once opened", async () => {
  const user = userEvent.setup();
  const { queryFn } = renderCombobox({
    items: [
      { value: "severity", tag: "synthetic" },
      { value: "rule-1", hint: "High 5xx rate" },
    ],
  });

  expect(queryFn).not.toHaveBeenCalled();

  await user.click(screen.getByRole("combobox", { name: "Matcher value" }));

  await screen.findByText("severity");
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
});

it("shows a friendly label while committing the underlying value", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox({
    items: [
      {
        value: "rule-3186",
        label: "Always firing (demo)",
        hint: "rule-3186",
      },
    ],
  });

  await user.click(screen.getByRole("combobox", { name: "Matcher value" }));
  expect(await screen.findByText("rule-3186")).toBeInTheDocument();
  await user.click(screen.getByText("Always firing (demo)"));

  expect(onChange).toHaveBeenCalledWith("rule-3186");
  expect(
    screen.getByRole("combobox", { name: "Matcher value" }),
  ).toHaveTextContent("Always firing (demo)");
});

it("can display a known label before loading suggestions", () => {
  const { queryFn } = renderCombobox({
    value: "rule-3186",
    displayValue: "Always firing (demo)",
  });

  expect(
    screen.getByRole("combobox", { name: "Matcher value" }),
  ).toHaveTextContent("Always firing (demo)");
  expect(queryFn).not.toHaveBeenCalled();
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
});
