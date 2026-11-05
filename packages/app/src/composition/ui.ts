import type { ComponentType, ReactNode } from "react";

export interface SignupPolicy {
  notice?: ReactNode;
  canSubmit: boolean;
  additionalData?: Record<string, unknown>;
}

export interface SignInFooterProps {
  redirect?: string;
  email?: string;
}

export interface ProductUI {
  useSignupPolicy(): SignupPolicy;
  SignInFooter: ComponentType<SignInFooterProps>;
  DeviceLoginRecovery: ComponentType;
}
