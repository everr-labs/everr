import type { ProductUI } from "@everr/app/composition";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { termsHash, termsUrl } from "../../legal/terms";

function useSignupPolicy() {
  const [accepted, setAccepted] = useState(false);
  const termsLink = (
    <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
      Terms of Service
    </a>
  );
  const privacyLink = (
    <a
      href="https://everr.dev/privacy"
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
    >
      Privacy Notice
    </a>
  );
  return {
    canSubmit: accepted,
    additionalData: accepted ? { termsHash } : undefined,
    notice: (
      <div className="space-y-2 text-sm text-muted-foreground">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
            className="mt-1 accent-primary"
          />
          <span>
            I agree to the {termsLink} and confirm I am using Everr for business or professional
            purposes.
          </span>
        </label>
        <p>Read our {privacyLink} to learn how we handle personal data.</p>
      </div>
    ),
  };
}

export const productUI: ProductUI = {
  useSignupPolicy,
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
