import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

const searchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/auth/reset-password")({
  validateSearch: searchSchema,
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const { token, error: searchError } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  const form = useForm({
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
    onSubmit: async ({ value }) => {
      if (value.newPassword !== value.confirmPassword) {
        setError("Passwords do not match.");
        return;
      }

      setError(null);
      setIsSubmitting(true);

      try {
        const result = await authClient.resetPassword({
          newPassword: value.newPassword,
          token,
        });

        if (result.error) {
          setError(
            result.error.message ??
              "Failed to reset password. Please try again.",
          );
          return;
        }

        setSucceeded(true);
      } catch {
        setError("An unexpected error occurred. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight font-heading">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your new password below
          </p>
        </div>

        {searchError === "INVALID_TOKEN" ? (
          <div className="space-y-4">
            <p className="text-sm text-destructive text-center" role="alert">
              This reset link is invalid or has expired.
            </p>
          </div>
        ) : succeeded ? (
          <div className="space-y-5 text-center">
            <p className="text-sm text-muted-foreground">
              Your password has been reset successfully.
            </p>
            <Button
              className="w-full"
              size="lg"
              onClick={() => void navigate({ to: "/auth/sign-in" })}
            >
              Sign in
            </Button>
          </div>
        ) : (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field name="newPassword">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Your new password"
                    required
                    autoComplete="new-password"
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="confirmPassword">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Confirm your new password"
                    required
                    autoComplete="new-password"
                  />
                </div>
              )}
            </form.Field>

            {error && (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isSubmitting || !token}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Resetting...
                </>
              ) : (
                "Reset password"
              )}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link
            to="/auth/forgot-password"
            className="font-medium text-foreground hover:underline"
          >
            Request a new reset link
          </Link>
        </p>
      </div>
    </main>
  );
}
