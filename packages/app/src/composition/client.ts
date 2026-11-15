import type { FileRouteTypes } from "@composition/routes";
import type { ResolveParams } from "@tanstack/react-router";
import type { EntryRedirect, EntryState } from "./entry";
import type {
  BuiltinManifestEntry,
  SharedBuiltinDashboardId,
} from "#app/data/dashboards/built-in/manifest.ts";

// These destinations have no accompanying route parameters.
export type ApplicationPath = {
  [Path in FileRouteTypes["to"]]: keyof ResolveParams<Path> extends never ? Path : never;
}[FileRouteTypes["to"]];

export interface ProductClient<Additional extends readonly BuiltinManifestEntry[] = readonly []> {
  homeDashboardId: SharedBuiltinDashboardId | Additional[number]["id"];
  additionalBuiltinManifest: Additional;
  missingWorkspaceRoute: ApplicationPath;
  entryRoutes: readonly ApplicationPath[];
  /**
   * Runs on every navigation, before any route guard, so it must not fetch.
   * Applications without entry decisions omit it and `ApplicationEntry.getEntryState`.
   */
  getEntryRedirect?(state: EntryState, pathname: string): EntryRedirect | undefined;
  telemetryEndpoint?: string;
  /**
   * The deployment stores browser session recordings, so the trace view and
   * the error detail play them and both lists can filter by them.
   */
  sessionRecordings: boolean;
}
