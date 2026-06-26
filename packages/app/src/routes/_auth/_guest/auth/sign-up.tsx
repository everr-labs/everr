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
  buildOnboardingCallbackURL,
  GoogleAuthButton,
} from "../-components/auth-page";

const SignUpSearchSchema = z.object({
  redirect: z.string().optional(),
  email: z.string().optional(),
});

export const Route = createFileRoute("/_auth/_guest/auth/sign-up")({
  validateSearch: SignUpSearchSchema,
  component: SignUp,
});

function SignUp() {
  const navigate = useNavigate();
  const { redirect: redirectTo, email: prefillEmail } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // New accounts always run onboarding first (org + GitHub setup); any caller
  // redirect (e.g. CLI device approval) is forwarded once onboarding completes.
  const callbackURL = buildOnboardingCallbackURL(redirectTo);
  const errorCallbackURL = buildAuthErrorCallbackURL("/auth/sign-up", {
    redirect: redirectTo,
    email: prefillEmail,
  });

  const form = useForm({
    defaultValues: {
      name: "",
      email: prefillEmail ?? "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      setIsSubmitting(true);

      try {
        const result = await authClient.signUp.email({
          name: value.name,
          email: value.email,
          password: value.password,
        });

        if (result.error) {
          setError(result.error.message ?? "Sign up failed. Please try again.");
          return;
        }

        await navigate({
          to: "/onboarding",
          search: redirectTo ? { redirect: redirectTo } : {},
        });
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
        title="Create your account"
        subtitle="Get started with Everr"
      />

      <div className="flex flex-col gap-4">
        <GoogleAuthButton
          label="Sign up with Google"
          callbackURL={callbackURL}
          newUserCallbackURL={callbackURL}
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
        <form.Field name="name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                type="text"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Your name"
                required
                autoComplete="name"
              />
            </div>
          )}
        </form.Field>

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
                placeholder="Choose a password"
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

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating account...
            </>
          ) : (
            "Sign up"
          )}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          to="/auth/sign-in"
          search={{ redirect: redirectTo, email: prefillEmail }}
          className="font-medium text-foreground hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
