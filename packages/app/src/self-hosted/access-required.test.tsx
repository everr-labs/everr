import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { WorkspaceAccessRequired } from "@/app/pages/access-required";

it("shows access instructions without offering workspace creation", () => {
  render(<WorkspaceAccessRequired />);
  expect(
    screen.getByRole("heading", { name: "Workspace access required" }),
  ).toBeVisible();
  expect(screen.getByText(/Contact your administrator/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Create/ })).toBeNull();
});
