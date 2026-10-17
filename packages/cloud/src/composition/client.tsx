import type { ProductClient } from "@everr/app/composition";
import { defaultProductClient } from "@everr/app/product/client";

export const productClient = {
  ...defaultProductClient,
  homeDashboardId: "telemetry-usage",
  additionalBuiltinManifest: [
    { id: "telemetry-usage", name: "Telemetry Usage" },
  ],
  missingWorkspaceRoute: "/choose-organization" as const,
  entryRoutes: [
    ...defaultProductClient.entryRoutes,
    "/organization-pending",
    "/organization-setup",
    "/create-organization",
    "/choose-organization",
  ],
  telemetryEndpoint: "https://ingest.everr.dev",
} satisfies ProductClient;
