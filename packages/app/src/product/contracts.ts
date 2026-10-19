/** Public contracts for composing an application, with no runtime imports. */

export type { BuiltinDashboard } from "../data/dashboards/built-in/types";
export type { ProductClient } from "./client";
export type { ApplicationDashboards } from "./dashboards";
export type { ApplicationIdentity } from "./identity";
export type { ApplicationLayouts, WelcomeProps } from "./layouts";
export type { Product } from "./module";
export type { ApplicationNavigation } from "./navigation";
export type { SessionOnboardingHookFactory } from "./onboarding";
export type {
  ApplicationPages,
  OrganizationPage,
  OrganizationPageProps,
} from "./pages";
export type { OrganizationPolicy, ProductPolicy } from "./policy";
export type { TenantRetention } from "./retention";
export type { ApplicationServer } from "./server";
export type { ApplicationStorage } from "./storage";
export type {
  ProductUI,
  SignInFooterProps,
} from "./ui";
