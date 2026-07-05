import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { AuthPageHeader } from "../-components/auth-page";

export const Route = createFileRoute("/_auth/_guest/auth/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
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
