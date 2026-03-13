import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { Bell, Download, Monitor, Terminal, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";

const DOCS_ORIGIN = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://everr.dev";
const APP_DOWNLOAD_BASE = `${DOCS_ORIGIN}/everr-app`;

const PLATFORMS = [
  {
    label: "macOS (Apple Silicon)",
    os: "macos",
    arch: "arm64",
    icon: Monitor,
  },
] as const;

function getDownloadUrl(os: string, arch: string) {
  return `${APP_DOWNLOAD_BASE}/everr-app-${os}-${arch}.dmg`;
}

export const Route = createFileRoute("/onboarding/app")({
  loader: async () => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({ data: "/onboarding/app" });
      throw redirect({ href: signInUrl });
    }

    if (!auth.organizationId) {
      throw redirect({ to: "/onboarding/organization" });
    }

    return null;
  },
  component: OnboardingAppStep,
});

function OnboardingAppStep() {
  const navigate = useNavigate();

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border bg-background text-lg font-semibold">
          3
        </div>
        <h1 className="mt-6 text-center text-4xl font-semibold tracking-tight">
          Install the Everr app
        </h1>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-8 sm:px-12">
          <h2 className="text-2xl font-semibold">Get the most out of Everr</h2>
          <p className="text-muted-foreground mt-2 text-base">
            With the desktop app you can:
          </p>

          <ul className="mt-6 space-y-4">
            <li className="flex items-start gap-3">
              <Bell className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <span className="text-sm">
                <strong>Get notifications</strong> when your CI/CD pipelines
                fail or need attention
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Terminal className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <span className="text-sm">
                <strong>Install the CLI</strong> to interact with Everr from
                your terminal
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Wrench className="text-muted-foreground mt-0.5 size-5 shrink-0" />
              <span className="text-sm">
                <strong>Integrate with your coding assistant</strong> &mdash;
                Cursor, Claude Code, Windsurf, and more
              </span>
            </li>
          </ul>

          <div className="mt-8 space-y-3">
            <p className="text-sm font-medium">Download for your platform</p>
            <div className="flex flex-wrap gap-3">
              {PLATFORMS.map((platform) => (
                <a
                  key={`${platform.os}-${platform.arch}`}
                  href={getDownloadUrl(platform.os, platform.arch)}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Download className="size-4" />
                  {platform.label}
                </a>
              ))}
            </div>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void navigate({ to: "/onboarding/github" })}
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void navigate({ to: "/dashboard" })}
            >
              Go to dashboard
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
