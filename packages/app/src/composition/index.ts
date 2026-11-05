/** Public contracts for composing an application, with no runtime imports. */

export type { BuiltinDashboard } from "../data/dashboards/built-in/types";
export type { Product } from "../product/module";
export type { ProductClient } from "./client";
export type { ApplicationDashboards } from "./dashboards";
export type { ApplicationDeployment } from "./deployment";
export type { ApplicationEntry, EntryRedirect } from "./entry";
export type { ApplicationIdentity } from "./identity";
export type { IdentityPolicy } from "./identity-policy";
export type { ApplicationLayouts, WelcomeProps } from "./layouts";
export type { ApplicationNavigation } from "./navigation";
export type { SessionOnboardingHookFactory } from "./onboarding";
export type { ApplicationPages, OrganizationPage, OrganizationPageProps } from "./pages";
export type { OrganizationPolicy, ProductPolicy } from "./policy";
export type { TenantRetention } from "./retention";
export type { ApplicationRuntime, ApplicationWorker } from "./runtime";
export type { ApplicationStorage } from "./storage";
export type { ProductUI, SignInFooterProps } from "./ui";

export type {
  ApplicationEvents,
  PublishedEvent,
  EventInput,
  EventDefinition,
  EventRoute,
  EventJob,
  EventPublisher,
} from "./events";
