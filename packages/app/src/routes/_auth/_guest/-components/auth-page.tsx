import { Button } from "@everr/ui/components/button";
import { Separator } from "@everr/ui/components/separator";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { siGoogle } from "simple-icons";
import { authClient } from "@/lib/auth-client";

export function AuthPageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-bold tracking-tight font-heading">
        {title}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

export function buildAuthErrorCallbackURL(
  path: "/auth/sign-in" | "/auth/sign-up",
  search: { redirect?: string; email?: string },
) {
  const params = new URLSearchParams();

  if (search.redirect) {
    params.set("redirect", search.redirect);
  }

  if (search.email) {
    params.set("email", search.email);
  }

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function AuthProviderSeparator() {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-xs text-muted-foreground">or</span>
      <Separator className="flex-1" />
    </div>
  );
}

export function GoogleAuthButton({
  callbackURL,
  newUserCallbackURL,
  errorCallbackURL,
  label,
  disabled,
  onError,
}: {
  callbackURL: string;
  newUserCallbackURL: string;
  errorCallbackURL: string;
  label: string;
  disabled?: boolean;
  onError: (message: string | null) => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleGoogleSignIn() {
    onError(null);
    setIsSubmitting(true);

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL,
        newUserCallbackURL,
        errorCallbackURL,
      });

      if (result.error) {
        onError(result.error.message ?? "Google sign-in failed.");
        setIsSubmitting(false);
      }
    } catch {
      onError("Google sign-in failed.");
      setIsSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={disabled || isSubmitting}
      onClick={() => void handleGoogleSignIn()}
    >
      {isSubmitting ? (
        <Loader2 data-icon="inline-start" className="animate-spin" />
      ) : (
        <GoogleIcon />
      )}
      {label}
    </Button>
  );
}

function GoogleIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      data-icon="inline-start"
    >
      <path d={siGoogle.path} />
    </svg>
  );
}
