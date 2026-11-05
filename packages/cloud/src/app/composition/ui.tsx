import type { ProductUI } from "@everr/app/composition";
import { Link } from "@tanstack/react-router";
export const productUI: ProductUI = {
  SignInFooter: ({ redirect, email }) => (
    <p className="text-center text-sm text-muted-foreground">
      Don&apos;t have an account?{" "}
      <Link
        to="/auth/sign-up"
        search={{ redirect, email }}
        className="font-medium text-foreground hover:underline"
      >
        Sign up
      </Link>
    </p>
  ),
  DeviceLoginRecovery: () => (
    <>
      Restart <code className="font-mono">everr cloud login</code> from your terminal.
    </>
  ),
};
