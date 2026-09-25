import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PanelShell } from "./panel-shell";

describe("PanelShell", () => {
  it("keeps known panel metadata visible while its query is pending", async () => {
    const user = userEvent.setup();
    render(
      <PanelShell
        title="Requests"
        description="Requests per minute"
        status="pending"
      >
        Chart content
      </PanelShell>,
    );

    expect(screen.getByText("Requests")).toBeVisible();
    const descriptionButton = screen.getByRole("button", {
      name: "About Requests",
    });
    expect(descriptionButton).toBeVisible();
    await user.hover(descriptionButton);
    expect(await screen.findByText("Requests per minute")).toBeVisible();
    expect(screen.queryByText("Chart content")).not.toBeInTheDocument();
  });
});
