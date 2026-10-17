export interface ProductClient {
  homeDashboardId: string;
  additionalBuiltinManifest: Array<{ id: string; name: string }>;
  missingWorkspaceRoute: string;
  entryRoutes: readonly string[];
  telemetryEndpoint?: string;
}

export const defaultProductClient = {
  homeDashboardId: "traces-overview",
  additionalBuiltinManifest: [] as Array<{ id: string; name: string }>,
  missingWorkspaceRoute: "/access-required" as const,
  entryRoutes: ["/access-required"],
  telemetryEndpoint: undefined as string | undefined,
} satisfies ProductClient;
