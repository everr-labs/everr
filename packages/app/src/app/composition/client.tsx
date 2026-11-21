import type { ProductClient } from "#app/composition/client.ts";
import { getEntryRedirect } from "../entry";

export const productClient: ProductClient = {
  homeDashboardId: "traces-overview",
  additionalBuiltinManifest: [],
  missingWorkspaceRoute: "/access-required",
  entryRoutes: ["/access-required"],
  getEntryRedirect,
};
