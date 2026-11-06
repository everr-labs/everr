import type { ProductUI } from "#app/composition/ui.ts";

export const productUI: ProductUI = {
  legalAcceptanceRequired: false,
  SignInFooter: () => (
    <p className="text-center text-sm text-muted-foreground">
      Contact your administrator for an invitation.
    </p>
  ),
  DeviceLoginRecovery: () => <>Restart the login from your terminal.</>,
};
