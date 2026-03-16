import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async () => {
    const auth = await getAuth();
    if (!auth.user) {
      throw redirect({ to: "/sign-in" });
    }
  },
});
