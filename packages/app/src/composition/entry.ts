import type { ApplicationPath } from "./client";

export type EntryRedirect = { href: ApplicationPath } | { to: ApplicationPath };

/** What entry decisions depend on. Cached with the session, so it must serialize. */
export type EntryState = { setupRequired: boolean };

/** Application entry decisions. Shared routes retain authentication and membership guards. */
export interface ApplicationEntry {
  /** Read on the server with the session; `ProductClient.getEntryRedirect` decides from it. */
  getEntryState?(): Promise<EntryState>;
  canOpenSignup(this: void, input: { redirect?: string }): Promise<boolean>;
  /** Called on the server only after verifying membership in the active organization. */
  getOrganizationEntryRedirect(session: {
    id: string;
    activeOrganizationId: string;
  }): Promise<{ to: ApplicationPath } | undefined>;
}
