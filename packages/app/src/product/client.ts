import type { ReactNode } from "react";

export interface ProductClient {
  publicSignup: boolean;
  canDeleteWorkspace: boolean;
  missingWorkspaceRoute: string;
  entryRoutes: readonly string[];
  telemetryEndpoint?: string;
  deviceLoginRestartInstruction: ReactNode;
}

export const defaultProductClient = {
  publicSignup: false,
  canDeleteWorkspace: false,
  missingWorkspaceRoute: "/access-required" as const,
  entryRoutes: ["/access-required"],
  telemetryEndpoint: undefined as string | undefined,
  deviceLoginRestartInstruction: "Restart the login from your terminal.",
} satisfies ProductClient;
