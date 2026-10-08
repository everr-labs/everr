import { Button } from "@everr/ui/components/button";
import { Card, CardContent, CardHeader } from "@everr/ui/components/card";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { INSTALL_COMMAND } from "@/common/install-command";
import { type HomeStatus, homeView } from "@/common/onboarding";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import {
  homeStatusQueryOptions,
  useCompleteOnboarding,
} from "@/data/onboarding/options";
import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  onboardingProgressKey,
  useSetupProgress,
} from "./use-setup-progress";

const STEP_TITLES: Record<OnboardingStep, string> = {
  install: "Install Everr",
  agent: "Connect your agent",
  local: "Setup telemetry",
  production: "To production",
};
const LOCAL_GUIDE = "https://everr.dev/docs/learn/instrument-your-app";
const PRODUCTION_GUIDE = "https://everr.dev/docs/guides/production-telemetry";
const PRODUCTION_ENDPOINT = "https://ingest.everr.dev/";
const SETUP_COMMAND = "/everr-setup-telemetry";

function CopyBlock({ text, label }: { text: string; label: string }) {
  const textRef = useRef<HTMLElement>(null);
  const { state, copy } = useCopyToClipboard(text, {
    selectOnFailure: textRef,
  });
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3 rounded-md border bg-muted/30 p-4">
        <code
          ref={textRef}
          className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed"
        >
          {text}
        </code>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          onClick={copy}
        >
          {state === "copied" ? <Check /> : <Copy />}
        </Button>
      </div>
      <p
        role="status"
        className={cn(
          "text-xs text-muted-foreground",
          state !== "failed" && "sr-only",
        )}
      >
        {state === "copied" && "Copied to clipboard."}
        {state === "failed" &&
          "Couldn't access the clipboard. The text is selected; copy it manually."}
      </p>
    </div>
  );
}

function GuideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      nativeButton={false}
      role="link"
      variant="outline"
      render={
        <a href={href} target="_blank" rel="noreferrer">
          {children}
          <ExternalLink data-icon="inline-end" />
        </a>
      }
    />
  );
}

export function HomeExperience({
  userId,
  organizationId,
  setupRequested,
  children,
}: {
  userId: string;
  organizationId: string;
  setupRequested: boolean;
  children: ReactNode;
}) {
  const status = useQuery(homeStatusQueryOptions(userId, organizationId));
  if (!status.data) {
    if (status.isError)
      return (
        <RetryError
          title="Couldn't load your setup"
          message={status.error.message}
          onRetry={() => void status.refetch()}
        />
      );
    return (
      <div
        className="mx-auto max-w-4xl space-y-6"
        role="status"
        aria-label="Loading your setup"
      >
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  return (
    <>
      {status.isError && (
        <RetryError
          variant="inline"
          title="Couldn't refresh your setup"
          message={status.error.message}
          onRetry={() => void status.refetch()}
        />
      )}
      <HomeContent
        key={onboardingProgressKey(userId, organizationId)}
        userId={userId}
        organizationId={organizationId}
        status={status.data}
        setupRequested={setupRequested}
      >
        {children}
      </HomeContent>
    </>
  );
}

function HomeContent({
  userId,
  organizationId,
  status,
  setupRequested,
  children,
}: {
  userId: string;
  organizationId: string;
  status: HomeStatus;
  setupRequested: boolean;
  children: ReactNode;
}) {
  const navigate = useNavigate({ from: "/" });
  const complete = useCompleteOnboarding(userId, organizationId);
  const progress = useSetupProgress(
    userId,
    organizationId,
    status.onboardingCompleted,
  );
  const { step, mode, selectMode } = progress;
  const savedIndex = ONBOARDING_STEPS.indexOf(progress.furthestStep);

  function advance(nextStep: OnboardingStep, nextMode = mode) {
    progress.advance(nextStep, nextMode);
    complete.reset();
  }

  const view = homeView(status, setupRequested);
  const busy = complete.isPending;

  async function finish() {
    try {
      await complete.mutateAsync();
      await navigate({
        to: "/",
        search: (previous) => ({ ...previous, setup: undefined }),
        replace: true,
      });
    } catch {
      // Completion errors remain visible, with the finish action available to retry.
    }
  }

  return (
    <div
      className={cn(
        "space-y-8",
        view === "onboarding" && "mx-auto max-w-3xl pb-8",
      )}
    >
      {view === "onboarding" && (
        <>
          <div className="space-y-2 pt-4">
            <p className="text-sm font-medium text-primary">
              Start with your app, on your machine
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              See where your app slows down or fails
            </h1>
            <p className="max-w-2xl text-muted-foreground">
              Get useful telemetry locally first. Then reuse your setup to
              monitor production with your team. Follow the guide below at your
              own pace.
            </p>
          </div>

          <nav
            aria-label="Setup progress"
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
          >
            {ONBOARDING_STEPS.map((item, index) => {
              const skipped =
                item === "agent" && mode === "manual" && index < savedIndex;
              return (
                <Button
                  key={item}
                  type="button"
                  variant={item === step ? "secondary" : "ghost"}
                  className="h-auto justify-start gap-2 whitespace-normal px-3 py-3 text-left"
                  disabled={index > savedIndex || busy}
                  aria-current={item === step ? "step" : undefined}
                  onClick={() => progress.review(item)}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs">
                    {index < savedIndex && !skipped ? (
                      <Check className="size-3" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>
                    {STEP_TITLES[item]}
                    {skipped && (
                      <span className="block text-xs text-muted-foreground">
                        Manual setup
                      </span>
                    )}
                  </span>
                </Button>
              );
            })}
          </nav>

          {step !== "production" && (
            <Card>
              <CardHeader>
                <h2 className="text-xl font-semibold">{STEP_TITLES[step]}</h2>
              </CardHeader>
              <CardContent className="space-y-5">
                {step === "install" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Run this command in your terminal. Local telemetry works
                      without signing in or creating an ingestion key.
                    </p>
                    <CopyBlock
                      text={INSTALL_COMMAND}
                      label="Copy install command"
                    />
                    <p className="text-xs text-muted-foreground">
                      The installer may also offer to install global agent
                      skills. Connect this project in the next step even if you
                      already installed them globally.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button disabled={busy} onClick={() => advance("agent")}>
                        CLI installed
                        <ArrowRight data-icon="inline-end" />
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => advance("agent")}
                      >
                        I already have the CLI
                      </Button>
                    </div>
                  </>
                )}
                {step === "agent" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Your coding agent can inspect the project, instrument it,
                      and verify the telemetry. You can also configure it by
                      hand.
                    </p>
                    <fieldset
                      className="flex flex-wrap gap-3"
                      aria-label="Setup method"
                    >
                      <Button
                        aria-pressed={mode === "agent"}
                        variant={mode === "agent" ? "secondary" : "outline"}
                        disabled={busy}
                        onClick={() => selectMode("agent")}
                      >
                        Use my coding agent
                      </Button>
                      <Button
                        aria-pressed={mode === "manual"}
                        variant={mode === "manual" ? "secondary" : "outline"}
                        disabled={busy}
                        onClick={() => advance("local", "manual")}
                      >
                        Set up manually
                      </Button>
                    </fieldset>
                    {mode === "agent" ? (
                      <>
                        <p className="text-sm text-muted-foreground">
                          From your project directory, install Everr's bundled
                          skills for your agent:
                        </p>
                        <CopyBlock
                          text="everr skills install --all --project"
                          label="Copy skills command"
                        />
                        <Button
                          disabled={busy}
                          onClick={() => advance("local")}
                        >
                          Project skills installed
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Manual setup skips the project skills. Select Set up
                        manually to continue to the instrumentation guide.
                      </p>
                    )}
                  </>
                )}
                {step === "local" && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Instrument the app in development, exercise a real path,
                      and find its telemetry in the local UI before preparing
                      production.
                    </p>
                    {mode === "agent" ? (
                      <>
                        <p className="text-sm">
                          Send this command to your coding agent from the
                          project:
                        </p>
                        <CopyBlock
                          text={SETUP_COMMAND}
                          label="Copy setup command"
                        />
                        <p className="text-xs text-muted-foreground">
                          The setup command also provides production
                          instructions and documents them in your project's
                          README.
                        </p>
                      </>
                    ) : (
                      <GuideLink href={LOCAL_GUIDE}>
                        Open the instrumentation guide
                      </GuideLink>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Use the local UI URL returned by the CLI. Copying a
                      command or opening a guide does not confirm that data
                      arrived.
                    </p>
                    <Button
                      disabled={busy}
                      onClick={() => advance("production")}
                    >
                      I can see my local telemetry
                      <ArrowRight data-icon="inline-end" />
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Keep the dialogs mounted when another member completes onboarding. Their
        portal can still show the newly issued key while these triggers hide. */}
      <section
        hidden={view !== "onboarding" || step !== "production"}
        aria-labelledby="production-telemetry"
        className="space-y-4 rounded-lg border bg-card p-5"
      >
        <h2 id="production-telemetry" className="text-xl font-semibold">
          {STEP_TITLES.production}
        </h2>
        <p className="text-sm text-muted-foreground">
          Create an ingestion key with the Send telemetry capability for{" "}
          {status.organizationName}. Use it with the Cloud endpoint below in
          your production deployment.
        </p>
        {status.canCreateKeys ? (
          <div className="flex flex-wrap gap-3">
            <CreateApiKeyDialog
              defaultScopes={["ingest"]}
              triggerLabel="Create ingestion key"
            />
            <CreateApiKeyDialog
              defaultPublic
              triggerLabel="Create public browser key"
              triggerVariant="outline"
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            An organization admin or owner needs to create the ingestion keys.
            You can still finish onboarding and ask an admin for keys when
            you're ready to deploy.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Server keys belong in your secret manager. Browser apps use public
          keys restricted to their origins. Already have keys? Reuse them.
        </p>
        <div className="space-y-2">
          <p className="text-sm font-medium">Production OTLP/HTTP endpoint</p>
          <CopyBlock
            text={PRODUCTION_ENDPOINT}
            label="Copy production endpoint"
          />
        </div>
        {mode === "agent" ? (
          <p className="text-sm text-muted-foreground">
            Follow the production instructions from the setup command in the
            previous step, also documented in your project's README. They
            explain where to set the key and endpoint, how to deploy, and how to
            verify Cloud ingestion. Keep local development connected to the
            local collector.
          </p>
        ) : (
          <GuideLink href={PRODUCTION_GUIDE}>
            Open the production guide
          </GuideLink>
        )}
        <div className="space-y-4 border-t pt-6">
          <p className="text-sm text-muted-foreground">
            You can finish now and deploy later. Cloud ingestion is verified
            separately when your production app sends data.
          </p>
          {complete.error && (
            <p role="alert" className="text-sm text-destructive">
              {complete.error.message}
            </p>
          )}
          <Button disabled={busy} onClick={() => void finish()}>
            {complete.isPending && (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            )}
            Finish onboarding
            <Check data-icon="inline-end" />
          </Button>
        </div>
      </section>

      {view === "dashboard" && children}
    </div>
  );
}
