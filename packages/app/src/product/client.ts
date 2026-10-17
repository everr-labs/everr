import type { ReactNode } from "react";

export interface ProductClient {
  homeDashboardId: string;
  additionalBuiltinManifest: Array<{ id: string; name: string }>;
  publicSignup: boolean;
  canDeleteWorkspace: boolean;
  missingWorkspaceRoute: string;
  entryRoutes: readonly string[];
  telemetryEndpoint?: string;
  deviceLoginRestartInstruction: ReactNode;
}

export const defaultProductClient = {
  homeDashboardId: "traces-overview",
  additionalBuiltinManifest: [] as Array<{ id: string; name: string }>,
  publicSignup: false,
  canDeleteWorkspace: false,
  missingWorkspaceRoute: "/access-required" as const,
  entryRoutes: ["/access-required"],
  telemetryEndpoint: undefined as string | undefined,
  deviceLoginRestartInstruction: "Restart the login from your terminal.",
} satisfies ProductClient;
