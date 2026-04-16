import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_auth/_guest")({
  beforeLoad: ({ context: { session } }) => {
    if (session?.user) {
      throw redirect({ to: "/" });
    }
  },
  component: Outlet,
});
