import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { siGoogle } from "simple-icons";
import { authClient } from "#app/lib/auth-client.ts";

export function GoogleConnection({ linked }: { linked: boolean }) {
  const link = useMutation({
    mutationFn: async () => {
      const result = await authClient.linkSocial({
        callbackURL: "/account",
        provider: "google",
      });
      if (result.error) throw new Error(result.error.message ?? "Google linking failed.");
    },
  });
  const googleButtonLabel = link.isPending ? "Connecting..." : linked ? "Linked" : "Connect Google";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Connection</CardTitle>
        <CardDescription>Link Google to sign in to this account with Google.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <GoogleIcon className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">Google</p>
              <p className="text-xs text-muted-foreground">
                {linked
                  ? "Google is linked as a sign-in method for this account."
                  : "Use Google as an additional sign-in method for this account."}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {linked ? <Badge variant="secondary">Connected</Badge> : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={link.isPending || linked}
              onClick={() => link.mutate()}
            >
              {link.isPending ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              {googleButtonLabel}
            </Button>
          </div>
        </div>
        {link.error ? (
          <p className="text-xs text-destructive" role="alert">
            {link.error.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      data-icon="inline-start"
    >
      <path d={siGoogle.path} />
    </svg>
  );
}
