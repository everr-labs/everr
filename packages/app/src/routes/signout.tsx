import { createFileRoute, redirect } from "@tanstack/react-router";
import { signOut } from "@workos/authkit-tanstack-react-start";

export const Route = createFileRoute("/signout")({
  loader: async () => {
    await signOut();
    throw redirect({ href: "/" });
  },
});
