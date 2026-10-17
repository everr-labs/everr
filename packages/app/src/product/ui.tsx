import {
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
} from "react";

export interface WelcomeActionsProps {
  activeOrganizationId?: string | null;
  disabled?: boolean;
  onSwitchingChange?: (switching: boolean) => void;
}

export interface ProductUI {
  OrganizationMenuItems: ComponentType;
  WorkspaceMenu: ComponentType;
  WelcomeActions: ComponentType<WelcomeActionsProps>;
}

const ProductUIContext = createContext<ProductUI | null>(null);

export function ProductUIProvider({
  value,
  children,
}: {
  value: ProductUI;
  children: ReactNode;
}) {
  return (
    <ProductUIContext.Provider value={value}>
      {children}
    </ProductUIContext.Provider>
  );
}

export function useProductUI(): ProductUI {
  const ui = useContext(ProductUIContext);
  if (!ui) throw new Error("ProductUIProvider is required for product UI.");
  return ui;
}
