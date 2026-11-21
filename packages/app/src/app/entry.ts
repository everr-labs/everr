import type { ProductClient } from "#app/composition/client.ts";

export const getEntryRedirect: NonNullable<ProductClient["getEntryRedirect"]> = (
  { setupRequired },
  pathname,
) => {
  if (setupRequired && pathname !== "/setup") return { href: "/setup" };
  if (!setupRequired && pathname === "/setup") return { to: "/" };
};
