import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/signout")({
  component: SignoutPage,
});

function SignoutPage() {
  const { signOut } = useAuth();
  const signOutCalled = useRef(false);

  useEffect(() => {
    if (signOutCalled.current) {
      return;
    }
    signOutCalled.current = true;
    void signOut({ returnTo: "/" });
  }, [signOut]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6 text-sm text-muted-foreground">
      Signing you out...
    </div>
  );
}
