import type { ApplicationPath } from "./client";

export type EntryRedirect = { href: ApplicationPath } | { to: ApplicationPath };

/** Application entry decisions. Shared routes retain authentication and membership guards. */
export interface ApplicationEntry {
  getEntryRedirect(pathname: string): Promise<EntryRedirect | undefined>;
  canOpenSignup(input: { redirect?: string }): Promise<boolean>;
  /** Called on the server only after verifying membership in the active organization. */
  getOrganizationEntryRedirect(session: {
    id: string;
    activeOrganizationId: string;
  }): Promise<{ to: ApplicationPath } | undefined>;
}
