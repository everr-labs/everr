// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Mail, Webhook } from "lucide-react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { OptionCombobox, type OptionComboboxItem } from "./option-combobox";

const OPTIONS: OptionComboboxItem[] = [
  {
    value: "webhook",
    label: "Webhook",
    description: "Send alerts to an HTTP endpoint.",
    icon: Webhook,
  },
  {
    value: "email",
    label: "Email",
    description: "Send alerts to an email address.",
    icon: Mail,
  },
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
  const trigger = screen.getByRole("combobox", { name: "Channel type" });
  expect(trigger).toHaveTextContent("Webhook");
  expect(trigger).not.toHaveTextContent("Send alerts to an HTTP endpoint.");
});

it("shows supporting copy inside the expanded options", async () => {
  const user = userEvent.setup();
  renderCombobox();

  await user.click(screen.getByRole("combobox", { name: "Channel type" }));

  expect(
    await screen.findByRole("option", { name: /Webhook/ }),
  ).toHaveTextContent("Send alerts to an HTTP endpoint.");
  expect(screen.getByRole("option", { name: /Email/ })).toHaveTextContent(
    "Send alerts to an email address.",
  );
});

it("shows the placeholder while no value is picked", () => {
  render(
    <OptionCombobox
      label="Receiver"
      value=""
      onChange={vi.fn()}
      options={OPTIONS}
      placeholder="Pick a receiver"
    />,
  );
  expect(screen.getByRole("combobox", { name: "Receiver" })).toHaveTextContent(
    "Pick a receiver",
  );
});

it("commits a picked option and closes", async () => {
  const user = userEvent.setup();
  const { onChange } = renderCombobox();

  await user.click(screen.getByRole("combobox", { name: "Channel type" }));
  await user.click(await screen.findByRole("option", { name: /Email/ }));

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
    await screen.findByRole("option", { name: /Webhook/ }),
  ).toHaveAttribute("data-checked");
  expect(screen.getByRole("option", { name: /Email/ })).not.toHaveAttribute(
    "data-checked",
  );
});

const GROUPED: OptionComboboxItem[] = [
  {
    value: "demo/always-firing",
    label: "Always firing",
    group: "demo",
  },
  {
    value: "checkout/latency",
    label: "Checkout latency",
    group: "checkout",
  },
];

it("lists options under their group headings", async () => {
  const user = userEvent.setup();
  render(
    <OptionCombobox
      label="Rule"
      value={null}
      onChange={vi.fn()}
      options={GROUPED}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Rule" }));

  await screen.findByRole("option", { name: /Always firing/ });
  const headings = [...document.querySelectorAll("[cmdk-group-heading]")];
  expect(headings.map((h) => h.textContent)).toEqual(["demo", "checkout"]);
});

it("finds a rule by its label, not only its value, when searchable", async () => {
  const user = userEvent.setup();
  render(
    <OptionCombobox
      label="Rule"
      value={null}
      onChange={vi.fn()}
      options={GROUPED}
      searchable
      searchPlaceholder="Search rules…"
      emptyMessage="No rule matches."
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Rule" }));
  await user.type(screen.getByPlaceholderText("Search rules…"), "checkout lat");

  expect(
    screen.getByRole("option", { name: /Checkout latency/ }),
  ).toBeVisible();
  expect(
    screen.queryByRole("option", { name: /Always firing/ }),
  ).not.toBeInTheDocument();

  await user.clear(screen.getByPlaceholderText("Search rules…"));
  await user.type(screen.getByPlaceholderText("Search rules…"), "nothing here");
  expect(await screen.findByText("No rule matches.")).toBeVisible();
});
