// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { TagsInput } from "./tags-input";

function renderTags(initial: string[], onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <TagsInput
        aria-label="Recipients"
        value={value}
        onValueChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }
  render(<Harness />);
  return { onChange };
}

it("removes an earlier tag with the keyboard, not just the last one", async () => {
  const user = userEvent.setup();
  const { onChange } = renderTags(["a@x.test", "b@x.test", "c@x.test"]);

  await user.tab();
  const removeFirst = screen.getByRole("button", { name: "Remove a@x.test" });
  expect(removeFirst).toHaveFocus();

  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenCalledWith(["b@x.test", "c@x.test"]);
});

it("backspace in the empty input still removes the last tag", async () => {
  const user = userEvent.setup();
  const { onChange } = renderTags(["a@x.test", "b@x.test"]);

  await user.click(screen.getByRole("textbox", { name: "Recipients" }));
  await user.keyboard("{Backspace}");
  expect(onChange).toHaveBeenCalledWith(["a@x.test"]);
});
