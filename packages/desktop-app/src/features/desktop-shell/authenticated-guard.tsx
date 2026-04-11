import { Navigate } from "@tanstack/react-router";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { useAuthStatusQuery } from "../auth/auth";
import { AppShell } from "./app-shell";
import { DesktopLoadingState } from "./ui";

export function AuthenticatedGuard() {
  const authStatusQuery = useAuthStatusQuery();

  if (authStatusQuery.isPending) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  if (authStatusQuery.data?.status !== "signed_in") {
    return <Navigate to="/onboarding" />;
  }

  return <AppShell />;
}
