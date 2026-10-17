import type { ComponentType } from "react";

export interface WelcomeActionsProps {
  activeOrganizationId?: string | null;
  disabled?: boolean;
  onSwitchingChange?: (switching: boolean) => void;
}

export interface ProductUI {
  MembersUnavailable?: ComponentType;
  OrganizationMenuItems?: ComponentType;
  WorkspaceMenu?: ComponentType;
  WelcomeActions?: ComponentType<WelcomeActionsProps>;
}

export const productUI: ProductUI = {};
