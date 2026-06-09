import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import {
  AuthPageHeader,
  AuthProviderSeparator,
  buildAuthErrorCallbackURL,
  GoogleAuthButton,
} from "../-components/auth-page";

const SignInSearchSchema = z.object({
  redirect: z.string().optional(),
  email: z.string().optional(),
});

export const Route = createFileRoute("/_auth/_guest/auth/sign-in")({
  validateSearch: SignInSearchSchema,
  component: SignIn,
});

function SignIn() {
  const navigate = useNavigate();
  const { redirect: redirectTo, email: prefillEmail } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const callbackURL = redirectTo ?? "/";
  const errorCallbackURL = buildAuthErrorCallbackURL("/auth/sign-in", {
    redirect: redirectTo,
    email: prefillEmail,
  });

  const form = useForm({
    defaultValues: {
      email: prefillEmail ?? "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setIsSubmitting(true);

      try {
        const result = await authClient.signIn.email({
          email: value.email,
          password: value.password,
        });

        if (result.error) {
          setError(result.error.message ?? "Sign in failed. Please try again.");
          return;
        }

        await navigate({ to: redirectTo ?? "/" });
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
        title="Sign in to Everr"
        subtitle="Enter your credentials to continue"
      />

      <div className="flex flex-col gap-4">
        <GoogleAuthButton
          label="Sign in with Google"
          callbackURL={callbackURL}
          newUserCallbackURL={redirectTo ?? "/onboarding"}
          errorCallbackURL={errorCallbackURL}
          disabled={isSubmitting}
          onError={setError}
        />
        <AuthProviderSeparator />
      </div>

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

        <form.Field name="password">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Your password"
                required
                autoComplete="current-password"
              />
            </div>
          )}
        </form.Field>

        <div className="flex justify-end">
          <Link
            to="/auth/forgot-password"
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Signing in...
            </>
          ) : (
            "Sign in"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link
          to="/auth/sign-up"
          className="font-medium text-foreground hover:underline"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}
