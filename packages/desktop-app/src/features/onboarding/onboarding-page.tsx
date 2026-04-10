import { Navigate } from "@tanstack/react-router";
import { useAuthStatusQuery } from "../auth/auth";
import { SignInScreen } from "../auth/sign-in-screen";

export function OnboardingPage() {
  const authStatusQuery = useAuthStatusQuery();

  if (authStatusQuery.data?.status === "signed_in") {
    return <Navigate to="/" />;
  }

  return <SignInScreen />;
}
