import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const auth = await getAuth();
    if (!auth.user) {
      const signInUrl = await getSignInUrl();
      throw redirect({ href: signInUrl });
    }

    if (!auth.organizationId) {
      throw redirect({ to: "/onboarding" });
    }
  },
});
