import type { ComponentType } from "react";
import { DeleteAccount } from "@/components/account-settings/delete-account";

export interface WelcomeActionProps {
  activeOrganizationId?: string | null;
}

export interface UserMenuContribution {
  id: string;
  placement: "before-organization" | "organization";
  component: ComponentType;
}

export interface SignInFooterProps {
  redirect?: string;
  email?: string;
}

export interface ProductUI {
  userMenu?: readonly UserMenuContribution[];
  welcomeActions?: readonly {
    id: string;
    component: ComponentType<WelcomeActionProps>;
  }[];
  SignInFooter: ComponentType<SignInFooterProps>;
  AccountDeletion: ComponentType;
  DeviceLoginRecovery: ComponentType;
}

export const productUI: ProductUI = {
  SignInFooter: () => (
    <p className="text-center text-sm text-muted-foreground">
      Contact your administrator for an invitation.
    </p>
  ),
  AccountDeletion: DeleteAccount,
  DeviceLoginRecovery: () => <>Restart the login from your terminal.</>,
};
