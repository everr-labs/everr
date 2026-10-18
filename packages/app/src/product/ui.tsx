import type { ComponentType } from "react";

export interface SignInFooterProps {
  redirect?: string;
  email?: string;
}

export interface ProductUI {
  SignInFooter: ComponentType<SignInFooterProps>;
  DeviceLoginRecovery: ComponentType;
}

export const productUI: ProductUI = {
  SignInFooter: () => (
    <p className="text-center text-sm text-muted-foreground">
      Contact your administrator for an invitation.
    </p>
  ),
  DeviceLoginRecovery: () => <>Restart the login from your terminal.</>,
};
