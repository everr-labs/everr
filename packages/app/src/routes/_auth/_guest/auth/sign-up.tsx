import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";

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

        await navigate({ to: redirectTo ?? "/onboarding" });
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
            Create your account
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Get started with Everr
          </p>
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
                  autoComplete="email"
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
            className="font-medium text-foreground hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
