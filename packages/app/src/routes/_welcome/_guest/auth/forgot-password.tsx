import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useRouteContext } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "#app/lib/auth-client.ts";
import { AuthPageHeader } from "../-components/auth-page";

export const Route = createFileRoute("/_welcome/_guest/auth/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const { emailEnabled } = useRouteContext({ from: "__root__" });
  return emailEnabled ? <EmailRecovery /> : <OperatorRecovery />;
}

function OperatorRecovery() {
  return (
    <>
      <AuthPageHeader
        title="Forgot your password?"
        subtitle="Contact your installation administrator"
      />
      <p className="text-sm text-muted-foreground">
        Email delivery is not configured. Your administrator can give you a recovery link to reset
        your password.
      </p>
      <details className="space-y-3 text-sm">
        <summary className="cursor-pointer font-medium">Manage this installation?</summary>
        <p>
          Run this command from your Compose directory on the server. Replace user@example.com with
          the account email.
        </p>
        <p>Generate a recovery link:</p>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
          <code>
            {
              "docker compose run --rm --no-deps app .output/server/recovery.mjs --email user@example.com"
            }
          </code>
        </pre>
      </details>
      <p className="text-center text-sm">
        <Link to="/auth/sign-in" className="font-medium">
          Back to sign in
        </Link>
      </p>
    </>
  );
}

function EmailRecovery() {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setIsSubmitting(true);

      try {
        const result = await authClient.requestPasswordReset({
          email: value.email,
          redirectTo: "/auth/reset-password",
        });

        if (result.error) {
          setError(result.error.message ?? "Failed to send reset email. Please try again.");
          return;
        }

        setSubmitted(true);
      } catch {
        setError("An unexpected error occurred. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  return (
    <>
      <AuthPageHeader
        title="Forgot your password?"
        subtitle="Enter your email and we'll send you a reset link"
      />

      {submitted ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">
            Check your email for a password reset link.
          </p>
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field name="email">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="username"
                />
              </div>
            )}
          </form.Field>

          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Sending...
              </>
            ) : (
              "Send reset link"
            )}
          </Button>
        </form>
      )}

      <p className="text-center text-sm text-muted-foreground">
        Remember your password?{" "}
        <Link to="/auth/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
