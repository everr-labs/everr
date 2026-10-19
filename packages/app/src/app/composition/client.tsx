import type { ProductClient } from "#app/product/client.ts";

export const productClient: ProductClient = {
  homeDashboardId: "traces-overview",
  additionalBuiltinManifest: [],
  missingWorkspaceRoute: "/access-required",
  entryRoutes: ["/access-required"],
};
