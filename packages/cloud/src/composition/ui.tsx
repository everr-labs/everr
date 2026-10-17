import { Link } from "@tanstack/react-router";
import { AccountDeletion } from "../components/account-deletion";
import type { ProductUI } from "@everr/app/product/ui";
import {
  OrganizationMenuItems,
  WorkspaceMenu,
  WelcomeActions,
} from "../app/navigation";

export const productUI: ProductUI = {
  userMenu: [
    {
      id: "workspaces",
      placement: "before-organization",
      component: WorkspaceMenu,
    },
    {
      id: "billing",
      placement: "organization",
      component: OrganizationMenuItems,
    },
  ],
  welcomeActions: [{ id: "organization-switcher", component: WelcomeActions }],
  AccountDeletion,
  SignInFooter: ({ redirect, email }) => (
    <p className="text-center text-sm text-muted-foreground">
      Don't have an account?{" "}
      <Link
        to="/auth/sign-up"
        search={{ redirect, email }}
        className="font-medium text-foreground hover:underline"
      >
        Sign up
      </Link>
    </p>
  ),
  DeviceLoginRecovery: () => (
    <>
      Restart <code className="font-mono">everr cloud login</code> from your
      terminal.
    </>
  ),
};
