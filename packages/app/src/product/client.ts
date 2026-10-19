import type { FileRouteTypes } from "@composition/routes";
import type {
  BuiltinManifestEntry,
  SharedBuiltinDashboardId,
} from "#app/data/dashboards/built-in/manifest.ts";

// These destinations have no accompanying route parameters.
type ApplicationPath = Exclude<FileRouteTypes["to"], `${string}$${string}`>;

export interface ProductClient<
  Additional extends readonly BuiltinManifestEntry[] = readonly [],
> {
  homeDashboardId: SharedBuiltinDashboardId | Additional[number]["id"];
  additionalBuiltinManifest: Additional;
  missingWorkspaceRoute: ApplicationPath;
  entryRoutes: readonly ApplicationPath[];
  telemetryEndpoint?: string;
}
