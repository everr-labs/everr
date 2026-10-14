import { createServerFn } from "@tanstack/react-start";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { invitation } from "@/db/schema";
import { getInstallation } from "./installation.server";

export const canOpenSignup = createServerFn({ method: "GET" })
  .inputValidator(z.object({ redirect: z.string().optional() }))
  .handler(async ({ data }) => {
    const match = /^\/invite\/([^/?#]+)(?:[?#].*)?$/.exec(data.redirect ?? "");
    const workspace = await getInstallation();
    if (!match || !workspace) return false;
    const [invite] = await db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.id, match[1]),
          eq(invitation.organizationId, workspace.id),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .limit(1);
    return Boolean(invite);
  });
