import type { ProductUI } from "#app/product/ui.ts";

export const productUI: ProductUI = {
  SignInFooter: () => (
    <p className="text-center text-sm text-muted-foreground">
      Contact your administrator for an invitation.
    </p>
  ),
  DeviceLoginRecovery: () => <>Restart the login from your terminal.</>,
};
