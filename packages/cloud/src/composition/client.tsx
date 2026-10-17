import {
  defaultProductClient,
  type ProductClient,
} from "@everr/app/product/client";

export const productClient = {
  ...defaultProductClient,
  homeDashboardId: "telemetry-usage",
  additionalBuiltinManifest: [
    { id: "telemetry-usage", name: "Telemetry Usage" },
  ],
  publicSignup: true,
  canDeleteWorkspace: true,
  missingWorkspaceRoute: "/choose-organization" as const,
  entryRoutes: [
    ...defaultProductClient.entryRoutes,
    "/organization-pending",
    "/organization-setup",
    "/create-organization",
    "/choose-organization",
  ],
  telemetryEndpoint: "https://ingest.everr.dev",
  deviceLoginRestartInstruction: (
    <>
      Restart <code className="font-mono">everr cloud login</code> from your
      terminal.
    </>
  ),
} satisfies ProductClient;
