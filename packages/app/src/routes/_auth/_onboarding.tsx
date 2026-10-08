import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/_onboarding")({
  beforeLoad: ({ context: { session }, location }) => {
    if (!session?.user)
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: location.href },
      });
    return { session };
  },
});
