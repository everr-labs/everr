import type { ApplicationEntry } from "#app/composition/entry.ts";
import { getInstallation } from "./installation.server";

export const getEntryRedirect: ApplicationEntry["getEntryRedirect"] = async (
  pathname,
) => {
  const setupRequired = !(await getInstallation());
  if (setupRequired && pathname !== "/setup") return { href: "/setup" };
  if (!setupRequired && pathname === "/setup") return { to: "/" };
};
