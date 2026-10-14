import { createServerFn } from "@tanstack/react-start";
import { socialProviders } from "@/lib/auth-providers.server";

export const getAuthProviders = createServerFn({ method: "GET" }).handler(
  () => ({
    googleSignInEnabled: Boolean(socialProviders?.google),
  }),
);
