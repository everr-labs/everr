import { z } from "zod";
import {
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from "@/lib/local-storage";

/**
 * Sticky UI flags for the dashboards rail. Local to the browser on purpose,
 * like last-viewed: how someone arranged their rail is a property of this
 * machine's session, not of the Organization.
 */
const BUILTINS_COLLAPSED_KEY = "everr:builtins-collapsed";

export function readBuiltinsCollapsed(): boolean {
  return readLocalStorage(BUILTINS_COLLAPSED_KEY, z.boolean()) ?? false;
}

export function writeBuiltinsCollapsed(collapsed: boolean): void {
  // Absence is the default (expanded), so only the exception is stored.
  if (collapsed) writeLocalStorage(BUILTINS_COLLAPSED_KEY, true);
  else removeLocalStorage(BUILTINS_COLLAPSED_KEY);
}
