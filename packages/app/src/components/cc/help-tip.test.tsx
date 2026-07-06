import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpTip } from "./help-tip";

describe("HelpTip", () => {
  it("hides the text until opened, as a labeled button", () => {
    render(<HelpTip text="Healthy means recent evaluations succeeded." />);

    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(
      screen.queryByText("Healthy means recent evaluations succeeded."),
    ).not.toBeInTheDocument();
  });

  it("reveals the text on click", async () => {
    const user = userEvent.setup();
    render(<HelpTip text="Healthy means recent evaluations succeeded." />);

    await user.click(screen.getByRole("button", { name: "Help" }));

    expect(
      await screen.findByText("Healthy means recent evaluations succeeded."),
    ).toBeInTheDocument();
  });

  it("is keyboard accessible: Tab focuses it, Enter opens it", async () => {
    const user = userEvent.setup();
    render(<HelpTip text="Healthy means recent evaluations succeeded." />);

    await user.tab();
    expect(screen.getByRole("button", { name: "Help" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(
      await screen.findByText("Healthy means recent evaluations succeeded."),
    ).toBeInTheDocument();
  });
});
