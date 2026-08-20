import type { z } from "zod";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "@/lib/local-storage";

/**
 * Where the reader last was in one kind of resource, so visiting its section
 * without naming one reopens it.
 *
 * Local to the browser on purpose: "where was I" is a property of this
 * machine's session, not of the Organization, so it needs no server state.
 * Keyed per organization as well, so a remembered resource from one org can
 * never open (or shadow) a same-named one after switching orgs in the same
 * browser.
 *
 * `resource` names the key, so it is part of the storage contract: changing it
 * forgets everyone's place rather than reading the old value.
 */
export function lastViewedStore<Schema extends z.ZodType>(
  resource: string,
  schema: Schema,
) {
  const keyFor = (org: string) => `everr:last-${resource}:${org}`;
  return {
    read: (org: string): z.infer<Schema> | null =>
      readLocalStorage(keyFor(org), schema),
    record: (org: string, value: z.infer<Schema>): void =>
      writeLocalStorage(keyFor(org), value),
    clear: (org: string): void => removeLocalStorage(keyFor(org)),
  };
}
