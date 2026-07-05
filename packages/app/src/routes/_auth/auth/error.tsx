import { buttonVariants } from "@everr/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { z } from "zod";

const AuthErrorSearchSchema = z.object({
  error: z.string().optional(),
});

type AuthErrorContent = {
  title: string;
  description: string;
  detail?: string;
};

const AUTH_ERROR_CONTENT: Record<string, AuthErrorContent> = {
  "email_doesn't_match": {
    title: "Google account mismatch",
    description:
      "The Google account you selected uses a different email than the Everr account you are trying to use.",
    detail: "Choose the Google account with the same email and try again.",
  },
};

export const Route = createFileRoute("/_auth/auth/error")({
  validateSearch: AuthErrorSearchSchema,
  head: () => ({
    meta: [{ title: "Everr - Authentication Error" }],
  }),
  component: AuthErrorPage,
});

function AuthErrorPage() {
  const { error } = Route.useSearch();
  const content = getAuthErrorContent(error);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="text-center">
          <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle aria-hidden="true" className="size-5" />
          </div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Authentication error</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We couldn&apos;t complete that authentication step.
          </p>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 text-card-foreground">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">{content.title}</h2>
            <p className="text-sm text-muted-foreground">{content.description}</p>
          </div>

          {content.detail ? (
            <p className="text-xs text-muted-foreground">{content.detail}</p>
          ) : null}

          {error ? <p className="font-mono text-xs text-muted-foreground">{error}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Link to="/" className={buttonVariants({ className: "w-full" })}>
            Back home
          </Link>
        </div>
      </div>
    </main>
  );
}

function getAuthErrorContent(error?: string): AuthErrorContent {
  if (error && AUTH_ERROR_CONTENT[error]) {
    return AUTH_ERROR_CONTENT[error];
  }

  return {
    title: "Authentication failed",
    description:
      "The authentication provider returned an error. Try again, or contact support if it keeps happening.",
  };
}
