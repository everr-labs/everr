import { productUI } from "@composition/ui";
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, redirect, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { returnToSchema } from "#app/common/return-to.ts";
import { canOpenSignup } from "#app/data/signup.ts";
import { authClient } from "#app/lib/auth-client.ts";
import {
  AuthPageHeader,
  AuthProviderSeparator,
  buildAuthErrorCallbackURL,
  buildPostAuthenticationURL,
  GoogleAuthButton,
} from "../-components/auth-page";

const SignUpSearchSchema = z.object({
  redirect: returnToSchema.optional(),
  email: z.string().optional(),
});

export const Route = createFileRoute("/_welcome/_guest/auth/sign-up")({
  validateSearch: SignUpSearchSchema,
  beforeLoad: async ({ search }) => {
    if (!(await canOpenSignup({ data: { redirect: search.redirect } }))) {
      throw redirect({ to: "/auth/sign-in", search, replace: true });
    }
  },
  component: SignUp,
});

function SignUp() {
  const { googleSignInEnabled } = Route.useRouteContext();
  const navigate = useNavigate();
  const { redirect: redirectTo, email: prefillEmail } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const maySignUp = !productUI.legalAcceptanceRequired || termsAccepted;
  const callbackURL = buildPostAuthenticationURL(redirectTo);
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
      if (!maySignUp) return;
      setError(null);
      setIsSubmitting(true);

      try {
        const result = await authClient.signUp.email({
          name: value.name,
          email: value.email,
          password: value.password,
          callbackURL,
        });

        if (result.error) {
          setError(result.error.message ?? "Sign up failed. Please try again.");
          return;
        }

        await navigate({
          href: redirectTo ?? "/",
          replace: true,
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
      <AuthPageHeader title="Create your account" subtitle="Get started with Everr" />

      {productUI.legalAcceptanceRequired && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <input
            id="terms-accepted"
            type="checkbox"
            className="mt-1"
            checked={termsAccepted}
            onChange={(event) => setTermsAccepted(event.target.checked)}
          />
          <label htmlFor="terms-accepted">
            I agree to the{" "}
            <a
              href="https://everr.dev/terms"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Terms of Service
            </a>{" "}
            and acknowledge the{" "}
            <a
              href="https://everr.dev/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Privacy Policy
            </a>
            .
          </label>
        </div>
      )}

      {googleSignInEnabled && (
        <div className="flex flex-col gap-4">
          <GoogleAuthButton
            label="Sign up with Google"
            callbackURL={callbackURL}
            errorCallbackURL={errorCallbackURL}
            disabled={isSubmitting || !maySignUp}
            onError={setError}
          />
          <AuthProviderSeparator />
        </div>
      )}

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

        <Button type="submit" className="w-full" disabled={isSubmitting || !maySignUp}>
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
