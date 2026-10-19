import type { FileRouteTypes } from "@composition/routes";
import type { ResolveParams } from "@tanstack/react-router";
import type {
  BuiltinManifestEntry,
  SharedBuiltinDashboardId,
} from "#app/data/dashboards/built-in/manifest.ts";

// These destinations have no accompanying route parameters.
export type ApplicationPath = {
  [Path in FileRouteTypes["to"]]: keyof ResolveParams<Path> extends never
    ? Path
    : never;
}[FileRouteTypes["to"]];

export interface ProductClient<
  Additional extends readonly BuiltinManifestEntry[] = readonly [],
> {
  homeDashboardId: SharedBuiltinDashboardId | Additional[number]["id"];
  additionalBuiltinManifest: Additional;
  missingWorkspaceRoute: ApplicationPath;
  entryRoutes: readonly ApplicationPath[];
  telemetryEndpoint?: string;
}
