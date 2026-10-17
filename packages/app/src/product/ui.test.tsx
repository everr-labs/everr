import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { type ProductUI, ProductUIProvider, useProductUI } from "./ui";

function Navigation() {
  const { OrganizationMenuItems } = useProductUI();
  return <OrganizationMenuItems />;
}

it("keeps each application's UI scoped to its provider", () => {
  const empty = () => null;
  const installation: ProductUI = {
    OrganizationMenuItems: () => <span>Installation settings</span>,
    WorkspaceMenu: empty,
    WelcomeActions: empty,
  };
  const restricted: ProductUI = {
    ...installation,
    OrganizationMenuItems: () => <span>Additional settings</span>,
  };
  render(
    <>
      <ProductUIProvider value={installation}>
        <Navigation />
      </ProductUIProvider>
      <ProductUIProvider value={restricted}>
        <Navigation />
      </ProductUIProvider>
    </>,
  );
  expect(screen.getByText("Installation settings")).toBeVisible();
  expect(screen.getByText("Additional settings")).toBeVisible();
});
