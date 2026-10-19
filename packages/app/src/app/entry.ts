import type { ApplicationServer } from "#app/product/server.ts";
import { getInstallation } from "./installation.server";

export const getEntryRedirect: ApplicationServer["getEntryRedirect"] = async (
  pathname,
) => {
  const setupRequired = !(await getInstallation());
  if (setupRequired && pathname !== "/setup") return { href: "/setup" };
  if (!setupRequired && pathname === "/setup") return { to: "/" };
};
