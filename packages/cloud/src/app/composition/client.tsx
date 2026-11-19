import type { ProductClient } from "@everr/app/composition";

const additionalBuiltinManifest = [{ id: "telemetry-usage", name: "Telemetry Usage" }] as const;

export const productClient = {
  homeDashboardId: "telemetry-usage",
  additionalBuiltinManifest,
  missingWorkspaceRoute: "/choose-organization" as const,
  entryRoutes: [
    "/organization-pending",
    "/organization-setup",
    "/create-organization",
    "/choose-organization",
  ],
  telemetryEndpoint: "https://ingest.everr.dev",
} satisfies ProductClient<typeof additionalBuiltinManifest>;
