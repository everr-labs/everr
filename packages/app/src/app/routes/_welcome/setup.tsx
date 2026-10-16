import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { completeSetup } from "@/app/setup";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_welcome/setup")({
  head: () => ({ meta: [{ title: "Everr - Set up your workspace" }] }),
  component: SetupPage,
});

function SetupPage() {
  const [created, setCreated] = useState(false);
  const setup = useMutation({
    mutationFn: async (data: Parameters<typeof completeSetup>[0]["data"]) => {
      await completeSetup({ data });
      setCreated(true);
      const result = await authClient.signIn.email({
        email: data.email,
        password: data.password,
      });
      if (result.error)
        throw new Error("Workspace created. Please sign in to continue.");
      window.location.assign("/");
    },
  });
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
            <a href="/auth/sign-in?redirect=%2F">Sign in</a>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (setup.isPending) return;
              const fields = new FormData(event.currentTarget);
              setup.mutate({
                workspaceName: String(fields.get("workspaceName") ?? ""),
                name: String(fields.get("name") ?? ""),
                email: String(fields.get("email") ?? ""),
                password: String(fields.get("password") ?? ""),
              });
            }}
          >
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
            <Button type="submit" className="w-full" disabled={setup.isPending}>
              {setup.isPending ? "Setting up..." : "Create workspace"}
            </Button>
          </form>
        )}
        {setup.error && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">
              {setup.error instanceof Error
                ? setup.error.message
                : "Setup failed. Please try again."}
            </p>
            {!created && (
              <p className="text-sm text-muted-foreground">
                If your workspace was created before the connection was lost,{" "}
                <a className="underline" href="/auth/sign-in?redirect=%2F">
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
