import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MultiStep } from "./multi-step";

it("locks future steps, allows reviewing confirmed steps, and leaves progress controlled by the caller", () => {
  const onStepChange = vi.fn();
  const steps = [
    { id: "first", title: "First", content: "First instructions" },
    {
      id: "second",
      title: "Second",
      content: "Second instructions",
      skipped: "Skipped by choice",
    },
    { id: "third", title: "Third", content: "Third instructions" },
    { id: "fourth", title: "Fourth", content: "Fourth instructions" },
  ];
  const props = {
    steps,
    currentStep: "third",
    furthestStep: "third",
    onStepChange,
  };
  const { rerender } = render(<MultiStep {...props} />);
  expect(screen.getByRole("button", { name: /Third/ })).toHaveAttribute(
    "aria-current",
    "step",
  );
  expect(screen.getByRole("button", { name: /Fourth/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Second/ })).toHaveTextContent(
    "Skipped by choice",
  );
  fireEvent.click(screen.getByRole("button", { name: /Fourth/ }));
  expect(onStepChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /First/ }));
  expect(onStepChange).toHaveBeenCalledWith("first");
  expect(screen.getByRole("region", { name: "Third" })).toBeVisible();
  rerender(<MultiStep {...props} currentStep="first" />);
  expect(screen.getByRole("region", { name: "First" })).toBeVisible();
  expect(screen.queryByText("Third instructions")).toBeNull();
  rerender(<MultiStep {...props} disabled />);
  expect(
    screen
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
});

it("preserves panel state across step changes and when the whole flow is hidden", () => {
  const steps = [
    { id: "first", title: "First", content: "First instructions" },
    {
      id: "second",
      title: "Second",
      content: <input aria-label="Draft" defaultValue="" />,
      keepMounted: true,
    },
  ];
  const props = {
    steps,
    currentStep: "second",
    furthestStep: "second",
    onStepChange: vi.fn(),
  };
  const { rerender } = render(<MultiStep {...props} />);
  fireEvent.change(screen.getByLabelText("Draft"), {
    target: { value: "Keep this value" },
  });
  rerender(<MultiStep {...props} currentStep="first" />);
  expect(screen.getByLabelText("Draft")).toHaveValue("Keep this value");
  expect(screen.getByLabelText("Draft")).not.toBeVisible();
  rerender(<MultiStep {...props} hidden />);
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByRole("region")).toBeNull();
  expect(screen.getByLabelText("Draft")).toHaveValue("Keep this value");
  rerender(<MultiStep {...props} />);
  expect(screen.getByLabelText("Draft")).toBeVisible();
  expect(screen.getByLabelText("Draft")).toHaveValue("Keep this value");
});
