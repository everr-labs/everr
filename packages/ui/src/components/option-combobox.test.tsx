// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Mail, Webhook } from "lucide-react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { OptionCombobox, type OptionComboboxItem } from "./option-combobox";

const OPTIONS: OptionComboboxItem[] = [
  { value: "webhook", label: "Webhook", icon: Webhook },
  { value: "email", label: "Email", icon: Mail },
];

function renderCombobox({ onChange = vi.fn() } = {}) {
  function Harness() {
    const [current, setCurrent] = useState("webhook");
    return (
      <OptionCombobox
        label="Channel type"
        value={current}
        onChange={(next) => {
          setCurrent(next);
          onChange(next);
        }}
        options={OPTIONS}
      />
    );
  }

  render(<Harness />);
  return { onChange };
}

it("shows the selected option's label on the trigger", () => {
  renderCombobox();
  expect(
    screen.getByRole("combobox", { name: "Channel type" }),
  ).toHaveTextContent("Webhook");
});

it("commits a picked option and closes", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox();

  await user.click(screen.getByRole("combobox", { name: "Channel type" }));
  await user.click(await screen.findByRole("option", { name: "Email" }));

  expect(onChange).toHaveBeenCalledWith("email");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(
    screen.getByRole("combobox", { name: "Channel type" }),
  ).toHaveTextContent("Email");
});

it("marks the current value's row as checked", async () => {
  const user = userEvent.setup();
  renderCombobox();

  await user.click(screen.getByRole("combobox", { name: "Channel type" }));

  expect(
    await screen.findByRole("option", { name: "Webhook" }),
  ).toHaveAttribute("data-checked");
  expect(screen.getByRole("option", { name: "Email" })).not.toHaveAttribute(
    "data-checked",
  );
});
