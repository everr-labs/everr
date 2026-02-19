import { createServerFn } from "@tanstack/react-start";
import { deleteCookie } from "@tanstack/react-start/server";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { getWorkOS } from "@/lib/workos";

const DeleteCurrentUserAccountInputSchema = z.object({
  confirmation: z.literal("DELETE"),
});

export const deleteCurrentUserAccount = createServerFn({ method: "POST" })
  .inputValidator(DeleteCurrentUserAccountInputSchema)
  .handler(async ({ data }) => {
    const requestId = crypto.randomUUID();
    const auth = await getAuth();

    if (!auth.user) {
      throw new Error("You need to sign in before updating your account.");
    }

    const workos = getWorkOS();

    try {
      await workos.userManagement.deleteUser(auth.user.id);
    } catch (error) {
      console.error("[account-settings] account_delete_failed", {
        requestId,
        userId: auth.user.id,
        error,
      });
      throw new Error(
        `We couldn't delete your account right now. Please try again. (ref: ${requestId})`,
      );
    }

    if (auth.sessionId) {
      try {
        await workos.userManagement.revokeSession({
          sessionId: auth.sessionId,
        });
      } catch (error) {
        console.error("[account-settings] session_revoke_failed", {
          requestId,
          userId: auth.user.id,
          sessionId: auth.sessionId,
          error,
        });
      }
    }

    const cookieNames = new Set([
      process.env.WORKOS_COOKIE_NAME,
      "wos-session",
      "wos_session",
    ]);

    for (const cookieName of cookieNames) {
      if (!cookieName) continue;
      deleteCookie(cookieName, {
        path: "/",
        domain: process.env.WORKOS_COOKIE_DOMAIN,
      });
    }

    return { success: true as const, confirmation: data.confirmation };
  });
