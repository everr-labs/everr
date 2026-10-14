import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { completeSetup } from "@/app/setup";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_welcome/setup")({
  head: () => ({ meta: [{ title: "Everr - Set up your workspace" }] }),
  component: SetupPage,
});

function SetupPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:py-16">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="font-heading text-3xl">Set up your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Create the workspace for this installation and its first owner. You
            can invite your team afterward.
          </p>
        </div>
        {created ? (
          <>
            <p>
              Your workspace has been created. Sign in with the owner account to
              configure telemetry ingestion.
            </p>
            <a href="/auth/sign-in?redirect=%2Forganization-setup">Sign in</a>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending) return;
              const fields = new FormData(event.currentTarget);
              const data = {
                token: String(fields.get("token") ?? ""),
                workspaceName: String(fields.get("workspaceName") ?? ""),
                name: String(fields.get("name") ?? ""),
                email: String(fields.get("email") ?? ""),
                password: String(fields.get("password") ?? ""),
              };
              setPending(true);
              setError(null);
              try {
                await completeSetup({ data });
                setCreated(true);
                const result = await authClient.signIn.email({
                  email: data.email,
                  password: data.password,
                });
                if (result.error)
                  throw new Error(
                    "Workspace created. Please sign in to continue.",
                  );
                window.location.assign("/organization-setup");
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Setup failed. Please try again.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="setup-token">Setup token</Label>
              <Input
                id="setup-token"
                name="token"
                type="password"
                required
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Use the setup token supplied by your administrator.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Workspace name</Label>
              <Input
                id="workspace-name"
                name="workspaceName"
                required
                minLength={2}
                maxLength={100}
                autoComplete="organization"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-name">Your name</Label>
              <Input
                id="owner-name"
                name="name"
                required
                maxLength={100}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-email">Email</Label>
              <Input
                id="owner-email"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner-password">Password</Label>
              <Input
                id="owner-password"
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Setting up..." : "Create workspace"}
            </Button>
          </form>
        )}
        {error && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
            {!created && (
              <p className="text-sm text-muted-foreground">
                If your workspace was created before the connection was lost,{" "}
                <a
                  className="underline"
                  href="/auth/sign-in?redirect=%2Forganization-setup"
                >
                  sign in with your owner account
                </a>{" "}
                to continue.
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
