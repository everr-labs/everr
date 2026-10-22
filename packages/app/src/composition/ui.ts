import type { ComponentType } from "react";

export interface SignInFooterProps {
  redirect?: string;
  email?: string;
}

export interface ProductUI {
  SignInFooter: ComponentType<SignInFooterProps>;
  DeviceLoginRecovery: ComponentType;
}
