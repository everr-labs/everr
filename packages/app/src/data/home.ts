import { queryOptions } from "@tanstack/react-query";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { deviceCode } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

export const getCliEverApproved = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context: { session } }) => {
  const rows = await db
    .select({ id: deviceCode.id })
    .from(deviceCode)
    .where(
      and(
        eq(deviceCode.userId, session.user.id),
        eq(deviceCode.status, "approved"),
      ),
    )
    .limit(1);

  return { cliEverApproved: rows.length > 0 };
});

export const cliEverApprovedOptions = () =>
  queryOptions({
    queryKey: ["home", "cliEverApproved"],
    queryFn: () => getCliEverApproved(),
    staleTime: 30_000,
  });
