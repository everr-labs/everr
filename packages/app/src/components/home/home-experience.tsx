import { Button } from "@everr/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { MultiStep, type MultiStepItem } from "@everr/ui/components/multi-step";
import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { type ReactNode, useRef } from "react";
import { INSTALL_COMMAND } from "@/common/install-command";
import { type HomeStatus, homeView } from "@/common/onboarding";
import { CreateApiKeyDialog } from "@/components/api-keys/create-api-key-dialog";
import {
  homeStatusQueryOptions,
  useCompleteOnboarding,
} from "@/data/onboarding/options";
import {
  type OnboardingStep,
  onboardingProgressKey,
  useSetupProgress,
} from "./use-setup-progress";

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
      <div className="flex items-center gap-3 rounded-md border bg-muted/20 p-4">
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
        className="mx-auto w-full min-w-0 max-w-3xl space-y-6"
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

  const steps = [
    {
      id: "install",
      title: "Install Everr",
      footer: (
        <Button disabled={busy} onClick={() => advance("agent")}>
          Continue
          <ArrowRight data-icon="inline-end" />
        </Button>
      ),
      content: (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <a
              href="https://everr.dev/docs/reference/cli"
              target="_blank"
              rel="noreferrer"
            >
              Everr CLI
            </a>{" "}
            is the fundamental tool to query local and cloud telemetry, and
            manage resources such as dashboards, alerts, runbooks, and bundled
            skills.
          </p>
          <CopyBlock text={INSTALL_COMMAND} label="Copy install command" />
        </>
      ),
    },
    {
      id: "agent",
      title: "Instrument your app",
      footer: (
        <Button disabled={busy} onClick={() => advance("local")}>
          Check my telemetry
          <ArrowRight data-icon="inline-end" />
        </Button>
      ),
      content: (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Instrumentation is the process of adding telemetry to your app.
            <br />
            Collected data is stored and queried locally for faster development
            feedback, and sent to Everr Cloud when you deploy your app.
          </p>
          <fieldset
            className="grid gap-3 sm:grid-cols-2"
            aria-label="Setup method"
          >
            <Button
              aria-label="Use my coding agent"
              aria-pressed={mode === "agent"}
              variant="outline"
              className={cn(
                "h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal",
                mode === "agent" && "border-primary/60 bg-primary/5",
              )}
              disabled={busy}
              onClick={() => selectMode("agent")}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  mode === "agent"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {mode === "agent" && <Check className="size-3" />}
              </span>
              <span className="space-y-1.5">
                <span className="block text-sm font-medium">
                  Use my coding agent
                </span>
                <span className="block text-xs font-normal leading-relaxed text-muted-foreground">
                  Install the skills and let your agent configure and verify
                  telemetry.
                </span>
              </span>
            </Button>
            <Button
              aria-label="Set up manually"
              aria-pressed={mode === "manual"}
              variant="outline"
              className={cn(
                "h-auto items-start justify-start gap-3 p-4 text-left whitespace-normal",
                mode === "manual" && "border-primary/60 bg-primary/5",
              )}
              disabled={busy}
              onClick={() => selectMode("manual")}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  mode === "manual"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {mode === "manual" && <Check className="size-3" />}
              </span>
              <span className="space-y-1.5">
                <span className="block text-sm font-medium">
                  Set up manually
                </span>
                <span className="block text-xs font-normal leading-relaxed text-muted-foreground">
                  Follow the guide and configure OpenTelemetry yourself.
                </span>
              </span>
            </Button>
          </fieldset>
          {mode === "agent" ? (
            <ol className="space-y-6">
              <li className="space-y-3">
                <h3 className="text-sm font-medium">
                  1. Install the Everr skills
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Our skills are specialized capabilities that help AI agents
                  handle observability tasks. Run the command below from the
                  project root.
                </p>
                <CopyBlock
                  text="everr skills install --all --project"
                  label="Copy skills command"
                />
              </li>
              <li className="space-y-3">
                <h3 className="text-sm font-medium">
                  2. Ask your agent to instrument the app
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Run the skill in your coding agent. It will inspect your app,
                  configure telemetry, and check that data arrives.
                  <br />
                  Yes, it works in monorepo projects too.
                </p>
                <CopyBlock text={SETUP_COMMAND} label="Copy setup command" />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Follow the agent's instructions until the end. Part of the
                  setup process continues there.
                </p>
              </li>
            </ol>
          ) : (
            <div className="space-y-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Follow the guide for your language or framework. Reuse any
                existing OpenTelemetry setup and point its exporter at your
                local collector. No agent skills or Cloud key needed.
              </p>
              <GuideLink href={LOCAL_GUIDE}>
                Open the instrumentation guide
              </GuideLink>
            </div>
          )}
        </>
      ),
    },
    {
      id: "local",
      title: "Verify locally",
      footer: (
        <Button disabled={busy} onClick={() => advance("production")}>
          I can see my local telemetry
          <ArrowRight data-icon="inline-end" />
        </Button>
      ),
      content: (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Check that you can see data from your running app before setting up
            production. You can use local observability also for debugging
            during development.
          </p>
          <ol className="space-y-5">
            <li className="space-y-2">
              <h3 className="text-sm font-medium">
                1. Open your local Everr UI
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                You can find the local UI URL in the output using the command
                below
              </p>
              <CopyBlock
                text="everr local status"
                label="Copy local status command"
              />
            </li>
            <li className="space-y-2">
              <h3 className="text-sm font-medium">2. Use your app</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Open a page, make a request, or run a job covered by your
                instrumentation. Keep the app running while you check Everr.
              </p>
            </li>
            <li className="space-y-2">
              <h3 className="text-sm font-medium">
                3. Find the data from that action
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Navigate the local UI and see your app's behavior throught logs,
                traces, and dashboards.
              </p>
            </li>
          </ol>
          <Collapsible className="rounded-md border text-sm">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-md px-4 py-3 text-left font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              No data yet?
              <ChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 px-4 pb-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Check that the collector is running and your app's exporter uses
                the <code>otlp:</code> URL from the status command. Restart the
                app after changing its configuration, then try the action again.
              </p>
              {mode === "agent" ? (
                <p>
                  Ask your agent to check the missing local telemetry using{" "}
                  <code>everr-setup-telemetry</code>, or go back to the
                  instrumentation step.
                </p>
              ) : (
                <GuideLink href={LOCAL_GUIDE}>
                  Open the instrumentation guide
                </GuideLink>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      ),
    },
    {
      id: "production",
      title: "To production",
      keepMounted: true,
      footer: (
        <Button disabled={busy} onClick={() => void finish()}>
          {complete.isPending && (
            <Loader2 className="animate-spin" data-icon="inline-start" />
          )}
          Finish onboarding
          <Check data-icon="inline-end" />
        </Button>
      ),
      content: (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            While local telemetry is sent to Everr Local, production telemetry
            must be sent to Everr Cloud.
          </p>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Configure your production app's OpenTelemetry exporter with Everr
              Cloud's endpoint and the appropriate ingestion key, then rebuild
              or restart your deployment. Use the app and check for fresh traces
              or logs in Everr Cloud.
            </p>
          </div>
          {status.canCreateKeys ? (
            <div className="grid gap-6 border-y py-6 sm:grid-cols-2 sm:gap-8">
              <div className="flex flex-col items-start gap-4">
                <div className="flex-1 space-y-1.5">
                  <h3 className="text-sm font-medium">Server</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A secret ingestion key for your services. Store it in your
                    secret manager.
                  </p>
                </div>
                <CreateApiKeyDialog
                  defaultScopes={["ingest"]}
                  triggerLabel="Create ingestion key"
                  triggerVariant="outline"
                />
              </div>
              <div className="flex flex-col items-start gap-4">
                <div className="flex-1 space-y-1.5">
                  <h3 className="text-sm font-medium">Browser</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A public key restricted to your app's origins. Safe to use
                    in the browser.
                  </p>
                </div>
                <CreateApiKeyDialog
                  defaultPublic
                  triggerLabel="Create public browser key"
                  triggerVariant="outline"
                />
              </div>
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              An organization admin or owner needs to create the ingestion keys.
              You can still finish onboarding and ask an admin for keys when
              you're ready to deploy.
            </p>
          )}
          <div className="space-y-2">
            <p className="text-sm font-medium">Production OTLP/HTTP endpoint</p>
            <CopyBlock
              text={PRODUCTION_ENDPOINT}
              label="Copy production endpoint"
            />
          </div>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Missing something? Ask to your AI Agent using the
              /everr-setup-telemetry skill or open{" "}
              <a href={PRODUCTION_GUIDE} target="_blank" rel="noreferrer">
                the production guide
              </a>
              .
            </p>
          </div>
          <div className="space-y-4">
            {complete.error && (
              <p role="alert" className="text-sm text-destructive">
                {complete.error.message}
              </p>
            )}
          </div>
        </>
      ),
    },
  ] satisfies MultiStepItem<OnboardingStep>[];

  return (
    <>
      <MultiStep
        steps={steps}
        currentStep={step}
        furthestStep={progress.furthestStep}
        onStepChange={progress.review}
        disabled={busy}
        hidden={view !== "onboarding"}
        navigationLabel="Setup progress"
      >
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Welcome to Everr
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground sm:text-base">
            Connect your app to see its traces, logs, and errors. We'll guide
            you through the setup process.
          </p>
        </div>
      </MultiStep>
      {view === "dashboard" && <div className="space-y-8">{children}</div>}
    </>
  );
}
