import type { ComponentType, ReactNode } from "react";

export interface WelcomeProps {
  signedIn: boolean;
  activeOrganizationId?: string | null;
  children: ReactNode;
}

export interface ApplicationLayouts {
  UserMenu: ComponentType;
  Welcome: ComponentType<WelcomeProps>;
}
