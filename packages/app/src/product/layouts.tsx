import type { ComponentType, ReactNode } from "react";
import { UserMenu } from "#app/components/nav-user.tsx";
import { WelcomeLayout } from "#app/components/welcome/welcome-layout.tsx";

export interface WelcomeProps {
  signedIn: boolean;
  activeOrganizationId?: string | null;
  children: ReactNode;
}

export interface ApplicationLayouts {
  UserMenu: ComponentType;
  Welcome: ComponentType<WelcomeProps>;
}

export const layouts: ApplicationLayouts = {
  UserMenu,
  Welcome: WelcomeLayout,
};
