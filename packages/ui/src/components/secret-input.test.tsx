// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it } from "vitest";
import { SecretInput } from "./secret-input";

function renderSecret(hasStoredSecret = true) {
  function Harness() {
    const [value, setValue] = useState("");
    return (
      <SecretInput
        aria-label="Webhook URL"
        hasStoredSecret={hasStoredSecret}
        value={value}
        onValueChange={setValue}
        placeholder="Enter a webhook URL"
      />
    );
  }

  render(<Harness />);
}

it("requires an explicit action before replacing a stored secret", async () => {
  const user = userEvent.setup();
  renderSecret();

  const stored = screen.getByRole("textbox", { name: "Webhook URL" });
  expect(stored).toHaveValue("Stored securely");
  expect(stored).toHaveAttribute("readonly");

  await user.click(screen.getByRole("button", { name: "Edit secret" }));

  const replacement = screen.getByLabelText("Webhook URL");
  expect(replacement).not.toHaveAttribute("readonly");
  expect(replacement).toHaveFocus();
  await user.type(replacement, "replacement");
  expect(replacement).toHaveValue("replacement");
});

it("cancels a replacement without changing the stored secret", async () => {
  const user = userEvent.setup();
  renderSecret();

  await user.click(screen.getByRole("button", { name: "Edit secret" }));
  await user.type(screen.getByLabelText("Webhook URL"), "replacement");
  await user.click(
    screen.getByRole("button", { name: "Cancel editing secret" }),
  );

  expect(screen.getByLabelText("Webhook URL")).toHaveValue("Stored securely");
  expect(screen.getByLabelText("Webhook URL")).toHaveAttribute("readonly");
});

it("renders an editable field when there is no stored secret", () => {
  renderSecret(false);

  expect(screen.getByLabelText("Webhook URL")).not.toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: "Edit secret" })).toBeNull();
});

it("does not submit its protected-state display text as a secret", async () => {
  const user = userEvent.setup();
  const data = new FormData();
  render(
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = new FormData(event.currentTarget);
        for (const [key, value] of submitted) data.append(key, value);
      }}
    >
      <SecretInput
        aria-label="Token"
        hasStoredSecret
        name="token"
        value=""
        onValueChange={() => {}}
      />
      <button type="submit">Save</button>
    </form>,
  );

  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(data.has("token")).toBe(false);
});
