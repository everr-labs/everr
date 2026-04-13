import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { cn } from "@everr/ui/lib/utils";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Copy,
  Loader2,
  SparklesIcon,
  Terminal,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ReactNode,
  type SubmitEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  CreateOrganizationInputSchema,
  OrganizationNameSchema,
} from "@/common/organization-name";
import { GithubInstallStep } from "@/components/github-install-step";
import {
  activeOrganizationOptions,
  markOnboardingComplete,
  updateOrganizationName,
} from "@/data/auth";
import {
  getGithubAppInstallStatus,
  getInstallationRepos,
  importRepos,
} from "@/data/onboarding";
import { authClient } from "@/lib/auth.client";

const STEPS = ["organization", "github", "workflows", "app"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  organization: "Organization",
  github: "GitHub",
  workflows: "Import",
  app: "Install",
};

const SLIDE_OFFSET = 60;
const SPRING = { type: "spring" as const, stiffness: 300, damping: 30 };

const stepVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? SLIDE_OFFSET : -SLIDE_OFFSET,
    opacity: 0,
    filter: "blur(4px)",
  }),
  center: {
    x: 0,
    opacity: 1,
    filter: "blur(0px)",
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -SLIDE_OFFSET : SLIDE_OFFSET,
    opacity: 0,
    filter: "blur(4px)",
  }),
};

const staggerContainer = {
  enter: {},
  center: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.02,
    },
  },
  exit: {},
};

const staggerItem = {
  enter: { opacity: 0, filter: "blur(4px)" },
  center: {
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: 0.3, ease: "easeOut" as const },
  },
  exit: {
    opacity: 0,
    filter: "blur(2px)",
    transition: { duration: 0.1 },
  },
};

export const Route = createFileRoute("/onboarding")({
  async beforeLoad({ context: { queryClient, session } }) {
    const organization = await queryClient.ensureQueryData(
      activeOrganizationOptions(),
    );

    // Safety net: org should always exist after signup (auto-created by hook).
    // If missing, proceed to onboarding which will handle it.
    if (!organization) {
      return { session, organization };
    }

    if (organization.metadata?.onboardingCompleted === true) {
      throw redirect({ to: "/" });
    }

    return { session, organization };
  },
  loader: async ({ context: { session, organization } }) => {
    let githubInstalled = false;
    if (session?.session.activeOrganizationId) {
      try {
        const status = await getGithubAppInstallStatus();
        // TODO: double check this
        githubInstalled = status.some((i) => i.status === "active");
      } catch {
        // proceed with false
      }
    }
    return { githubInstalled, organization };
  },
  component: OnboardingWizard,
});

function OnboardingWizard() {
  const { githubInstalled, organization: initialOrganization } =
    Route.useLoaderData();
  const { data: sessionData, isPending: authLoading } = authClient.useSession();
  const user = sessionData?.user;
  const navigate = useNavigate();
  const { data: organization } = useQuery({
    ...activeOrganizationOptions(),
    initialData: initialOrganization,
  });

  const organizationName = organization?.name ?? "";

  const [currentStep, setCurrentStep] = useState<Step>("organization");
  const [[stepKey, direction], setStepState] = useState<[number, number]>([
    0, 0,
  ]);

  const currentStepIndex = STEPS.indexOf(currentStep);

  const containerRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(
    undefined,
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const child = el.firstElementChild as HTMLElement | null;
      if (child) setContentHeight(child.offsetHeight);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [isGithubInstalled, setIsGithubInstalled] = useState(githubInstalled);

  if (authLoading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background" />
    );
  }

  function goTo(step: Step) {
    const targetIdx = STEPS.indexOf(step);
    const dir = targetIdx > currentStepIndex ? 1 : -1;
    setStepState(([k]) => [k + 1, dir]);
    setCurrentStep(step);
  }

  function goBack() {
    if (currentStepIndex > 0) goTo(STEPS[currentStepIndex - 1]);
  }

  function goForward() {
    if (currentStepIndex < STEPS.length - 1) goTo(STEPS[currentStepIndex + 1]);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16 ">
      <motion.div
        className="relative z-10 w-full max-w-xl"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: {},
          visible: { transition: { staggerChildren: 0.12 } },
        }}
      >
        {/* Stepper */}
        <motion.nav
          variants={{
            hidden: { opacity: 0, y: -16 },
            visible: {
              opacity: 1,
              y: 0,
              transition: SPRING,
            },
          }}
          className="mb-12"
          aria-label="Onboarding progress"
        >
          <div className="relative flex border border-border bg-card rounded-md overflow-hidden">
            {/* Active step indicator + accent bar */}
            {[
              "pointer-events-none absolute inset-y-0 bg-primary/[0.07]",
              "pointer-events-none absolute bottom-0 h-0.5 bg-primary",
            ].map((cls) => (
              <motion.div
                key={cls}
                className={cls}
                initial={false}
                animate={{
                  left: `${(currentStepIndex / STEPS.length) * 100}%`,
                  width: `${100 / STEPS.length}%`,
                }}
                transition={SPRING}
              />
            ))}

            {STEPS.map((step, i) => {
              const isActive = i === currentStepIndex;
              const isComplete = i < currentStepIndex;
              const isSkipped =
                step === "workflows" && !isGithubInstalled && isComplete;
              const isClickable = i <= currentStepIndex && !isSkipped;

              return (
                <button
                  key={step}
                  type="button"
                  onClick={() =>
                    isClickable && step !== currentStep && goTo(step)
                  }
                  disabled={!isClickable}
                  className={cn(
                    "relative flex flex-1 items-center justify-center gap-2 px-3 py-3 text-xs font-medium outline-none transition-colors disabled:cursor-default",
                    isSkipped
                      ? "text-muted-foreground/30"
                      : isActive
                        ? "text-foreground"
                        : isComplete
                          ? "text-muted-foreground hover:text-foreground"
                          : "text-muted-foreground/50",
                  )}
                >
                  {isComplete && !isSkipped ? (
                    <span className="flex size-5 items-center justify-center bg-primary/15 text-primary">
                      <Check className="size-3" strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span
                      className={`flex size-5 items-center justify-center text-[10px] font-semibold ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {i + 1}
                    </span>
                  )}
                  <span className="tracking-wide">{STEP_LABELS[step]}</span>
                </button>
              );
            })}
          </div>
        </motion.nav>

        {/* Step content */}
        <motion.div
          variants={{
            hidden: { opacity: 0, y: 16 },
            visible: {
              opacity: 1,
              y: 0,
              transition: SPRING,
            },
          }}
        >
          <motion.div
            className="relative overflow-hidden"
            initial={false}
            animate={{ height: contentHeight }}
            transition={SPRING}
          >
            <div ref={containerRef}>
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={stepKey}
                  custom={direction}
                  variants={stepVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={SPRING}
                >
                  {currentStep === "organization" && (
                    <OrganizationStep
                      user={user}
                      organizationName={organizationName}
                      onComplete={goForward}
                    />
                  )}
                  {currentStep === "github" && (
                    <GitHubStep
                      installed={isGithubInstalled}
                      onInstalled={() => setIsGithubInstalled(true)}
                      onBack={goBack}
                      onComplete={goForward}
                      onSkip={() => goTo("app")}
                    />
                  )}
                  {currentStep === "workflows" && (
                    <WorkflowsStep
                      githubInstalled={isGithubInstalled}
                      onBack={goBack}
                      onComplete={goForward}
                      onSkip={goForward}
                    />
                  )}
                  {currentStep === "app" && (
                    <AppStep
                      onBack={() =>
                        goTo(isGithubInstalled ? "workflows" : "github")
                      }
                      onFinish={async () => {
                        await markOnboardingComplete();
                        await navigate({ to: "/" });
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </main>
  );
}

function OrganizationStep({
  user,
  organizationName,
  onComplete,
}: {
  user: { email: string };
  organizationName: string;
  onComplete: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: { organizationName },
    onSubmit: () => {},
    validators: {
      onChange: CreateOrganizationInputSchema,
    },
  });

  const mutation = useMutation({
    mutationFn: async (orgName: string) => {
      await updateOrganizationName({ data: { organizationName: orgName } });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries(activeOrganizationOptions());
      onComplete();
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "We couldn't finish setup. Please try again.",
      );
    },
  });

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (mutation.isPending) return;

    const orgName = form.getFieldValue("organizationName");
    const parsed = OrganizationNameSchema.safeParse(orgName);
    if (!parsed.success) return;

    if (orgName === organizationName) {
      onComplete();
      return;
    }

    setErrorMessage(null);
    mutation.mutate(orgName);
  }

  return (
    <StepContainer
      title="Set up your workspace"
      description={
        <>
          Signed in as{" "}
          <span className="font-medium text-foreground">{user.email}</span>
        </>
      }
      index={1}
    >
      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10 rounded-md"
      >
        <h2 className="text-lg font-semibold">Organization details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your team's home on Everr. You can always change this later.
        </p>

        <form className="mt-8 space-y-5" onSubmit={(e) => void handleSubmit(e)}>
          <form.Field name="organizationName">
            {(field) => (
              <div className="space-y-2">
                <Label
                  htmlFor="organization-name"
                  className="text-xs font-medium tracking-wide text-muted-foreground"
                >
                  Organization name
                </Label>
                <Input
                  id="organization-name"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Acme Inc."
                  required
                  autoComplete="organization"
                />

                {field.state.meta.errors.length > 0 && (
                  <p
                    className="text-xs text-destructive overflow-hidden"
                    role="alert"
                  >
                    {field.state.meta.errors
                      .map((error) => error?.message)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <AnimatePresence>
            {errorMessage && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-destructive overflow-hidden"
                role="alert"
              >
                {errorMessage}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="flex items-center justify-end pt-1">
            <Button type="submit" size="lg" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="ml-2 size-3.5" />
                </>
              )}
            </Button>
          </div>
        </form>
      </motion.section>
    </StepContainer>
  );
}

function GitHubStep({
  installed,
  onInstalled,
  onBack,
  onComplete,
  onSkip,
}: {
  installed: boolean;
  onInstalled: () => void;
  onBack: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  return (
    <StepContainer title="Connect your repos" index={2}>
      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10  rounded-md"
      >
        <GithubInstallStep
          installed={installed}
          onInstalled={onInstalled}
          onContinue={onComplete}
          onSkip={onSkip}
          onBack={onBack}
        />
      </motion.section>
    </StepContainer>
  );
}

const INSTALL_URL = import.meta.env.DEV
  ? "http://localhost:3000/install-dev.sh"
  : "https://everr.dev/install.sh";
const INSTALL_COMMAND = `curl -fsSL ${INSTALL_URL} | sh`;

const APP_FEATURES = [
  {
    icon: Bell,
    title: "Get notifications",
    description: "when your CI/CD pipelines fail or need attention",
  },
  {
    icon: Terminal,
    title: "Install the CLI",
    description: "to interact with Everr from your terminal",
  },
  {
    icon: SparklesIcon,
    title: "Integrate with your editor",
    description: "Codex, Claude Code, Cursor, and more",
  },
] as const;

function WorkflowsStep({
  githubInstalled,
  onBack,
  onComplete,
  onSkip,
}: {
  githubInstalled: boolean;
  onBack: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [showSuccess, setShowSuccess] = useState(false);
  const [importingRepo, setImportingRepo] = useState<{
    name: string;
    index: number;
    total: number;
  } | null>(null);
  const [progress, setProgress] = useState<{
    jobsEnqueued: number;
    jobsQuota: number;
    runsProcessed: number;
  } | null>(null);

  const reposQuery = useQuery({
    queryKey: ["onboarding", "installation-repos"],
    queryFn: () => getInstallationRepos(),
    enabled: githubInstalled,
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      let totalJobs = 0;
      let totalErrors = 0;
      const stream = await importRepos({
        data: { repos: Array.from(selectedRepos) },
      });
      for await (const event of stream) {
        switch (event.type) {
          case "repo-start":
            setImportingRepo({
              name: event.repoFullName,
              index: event.repoIndex,
              total: event.reposTotal,
            });
            break;
          case "progress":
            setProgress(event.progress);
            break;
          case "repo-error":
            console.error(`Import failed for ${event.repoFullName}`);
            break;
          case "done":
            totalJobs = event.totalJobs;
            totalErrors = event.totalErrors;
            break;
        }
      }
      setImportingRepo(null);
      setProgress(null);
      return { totalJobs, totalErrors };
    },
    onSuccess: (result) => {
      if (result.totalJobs > 0 || result.totalErrors === 0) {
        setShowSuccess(true);
      }
    },
  });

  const maxRepos = 3;

  function toggleRepo(fullName: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(fullName)) {
        next.delete(fullName);
      } else if (next.size < maxRepos) {
        next.add(fullName);
      }
      return next;
    });
  }

  if (!githubInstalled) {
    return null;
  }

  return (
    <StepContainer
      title="Import workflows"
      description="Select repositories to import recent workflow history from."
      index={3}
    >
      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10 rounded-md"
      >
        {showSuccess ? (
          <div className="flex flex-col items-center py-8">
            <Check className="size-8 text-green-400" />
            <p className="mt-4 text-sm text-foreground">
              Import completed successfully.
            </p>
            <p className="mt-1 text-sm text-center text-muted-foreground">
              Your data is being processed and will appear gradually on the
              dashboard.
            </p>
            <Button
              type="button"
              size="lg"
              className="mt-6"
              onClick={onComplete}
            >
              Continue
              <ArrowRight className="ml-2 size-3.5" />
            </Button>
          </div>
        ) : importMutation.isPending ? (
          <div className="flex flex-col items-center py-8">
            <p className="text-sm text-muted-foreground">
              Importing runs from{importingRepo ? ` ${importingRepo.name}` : ""}
            </p>
            <div className="mt-4 w-full max-w-xs">
              <div className="h-2 w-full overflow-hidden bg-muted">
                <div
                  className={cn(
                    "h-full bg-primary",
                    progress
                      ? "transition-all duration-300"
                      : "animate-fake-progress",
                  )}
                  style={
                    progress
                      ? {
                          width: `${10 + Math.min((progress.jobsEnqueued / progress.jobsQuota) * 90, 90)}%`,
                        }
                      : undefined
                  }
                />
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {progress
                  ? `${progress.runsProcessed} runs imported`
                  : "Gathering the runs list"}
              </p>
            </div>
          </div>
        ) : (
          <>
            {reposQuery.isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}

            {reposQuery.isError && (
              <div className="py-4 text-sm text-red-400">
                Failed to load repositories. Please try again.
              </div>
            )}

            {reposQuery.data && (
              <div className="space-y-1">
                {reposQuery.data.length > 0 && (
                  <p className="px-3 pb-1 text-xs text-muted-foreground">
                    Select up to {maxRepos} repositories
                  </p>
                )}
                {reposQuery.data.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No repositories found for this installation.
                  </p>
                ) : (
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {reposQuery.data.map((repo) => {
                      const selected = selectedRepos.has(repo.fullName);
                      const disabled =
                        !selected && selectedRepos.size >= maxRepos;
                      return (
                        <li key={repo.id}>
                          <button
                            type="button"
                            onClick={() => toggleRepo(repo.fullName)}
                            disabled={disabled}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                              selected
                                ? "bg-primary/10 text-foreground"
                                : disabled
                                  ? "cursor-not-allowed text-muted-foreground/40"
                                  : "text-muted-foreground hover:bg-muted/50",
                            )}
                          >
                            <div
                              className={cn(
                                "flex size-4 shrink-0 items-center justify-center border",
                                selected
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-muted-foreground/30",
                              )}
                            >
                              {selected && <Check className="size-3" />}
                            </div>
                            <span className="truncate">{repo.fullName}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {importMutation.isError && (
              <div className="mt-4 text-sm text-red-400">
                Import failed. You can try again or skip this step.
              </div>
            )}

            {importMutation.isSuccess &&
              importMutation.data.totalErrors > 0 &&
              importMutation.data.totalJobs === 0 && (
                <div className="mt-4 flex items-center justify-between text-sm text-amber-400">
                  Could not import any workflow data. You can try again or skip
                  this step.
                </div>
              )}

            <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onBack}
              >
                <ArrowLeft className="mr-2 size-3.5" />
                Back
              </Button>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={onSkip}
                  className="text-muted-foreground"
                >
                  Skip
                </Button>
                <Button
                  type="button"
                  size="lg"
                  onClick={() => importMutation.mutate()}
                  disabled={selectedRepos.size === 0}
                >
                  Import
                  <ArrowRight className="ml-2 size-3.5" />
                </Button>
              </div>
            </div>
          </>
        )}
      </motion.section>
    </StepContainer>
  );
}

function AppStep({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  onFinish: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(INSTALL_COMMAND).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <StepContainer title="Install Everr" index={4}>
      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10 rounded-md"
      >
        <h2 className="text-lg font-semibold">Get the most out of Everr</h2>

        <div className="mt-6">
          {APP_FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              variants={staggerItem}
              className="flex items-center gap-4 py-4 first:pt-0 last:pb-0"
            >
              <motion.div
                className="flex size-9 shrink-0 items-center justify-center border border-border bg-muted/50 rounded-md"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 20,
                  delay: 0.2 + i * 0.08,
                }}
              >
                <feature.icon className="size-4 text-primary" />
              </motion.div>
              <p className="text-sm">
                <span className="font-semibold">{feature.title}</span>{" "}
                <span className="text-muted-foreground">
                  {feature.description}
                </span>
              </p>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">
            Run in your terminal
          </p>
          <div className="mt-3 flex items-center gap-2 border border-border bg-muted/50 px-4 py-3 font-mono text-sm rounded-md">
            <code className="flex-1 truncate text-xs">{INSTALL_COMMAND}</code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              {copied ? (
                <Check className="size-4 text-green-400" />
              ) : (
                <Copy className="size-4" />
              )}
            </button>
          </div>
        </div>

        <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
          <Button type="button" variant="outline" size="lg" onClick={onBack}>
            <ArrowLeft className="mr-2 size-3.5" />
            Back
          </Button>
          <Button type="button" size="lg" onClick={onFinish}>
            Go to dashboard
            <ArrowRight className="ml-2 size-3.5" />
          </Button>
        </div>
      </motion.section>
    </StepContainer>
  );
}

interface StepContainerProps {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  index: number;
}
function StepContainer({
  children,
  title,
  description,
  index,
}: StepContainerProps) {
  return (
    <motion.div variants={staggerContainer} initial="enter" animate="center">
      <div>
        <p className="text-center text-xs font-medium font-heading tracking-widest text-muted-foreground uppercase">
          Step {index}
        </p>
        <h1 className="mt-2 text-center text-3xl font-bold tracking-tight sm:text-4xl font-heading">
          {title}
        </h1>
        {description && (
          <p className="mt-3 text-center text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>

      {children}
    </motion.div>
  );
}
