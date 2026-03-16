import { SiApple } from "@icons-pack/react-simple-icons";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import type { Organization } from "@workos-inc/node";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  ExternalLink,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  activeOrganizationOptions,
  markOnboardingComplete,
  updateOrganizationName,
} from "@/data/auth";
import {
  createOrganizationForCurrentUser,
  getGithubAppInstallStatus,
} from "@/data/onboarding";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ["organization", "github", "app"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  organization: "Organization",
  github: "GitHub",
  app: "Desktop App",
};

const DOCS_ORIGIN = import.meta.env.DEV
  ? "http://localhost:3000"
  : "https://everr.dev";
const APP_DOWNLOAD_BASE = `${DOCS_ORIGIN}/everr-app`;

const PLATFORMS = [
  {
    label: "macOS (Apple Silicon)",
    os: "macos",
    arch: "arm64",
    icon: SiApple,
  },
] as const;

function getDownloadUrl(os: string, arch: string) {
  return `${APP_DOWNLOAD_BASE}/everr-app-${os}-${arch}.dmg`;
}

// ---------------------------------------------------------------------------
// Motion variants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/onboarding")({
  async beforeLoad({ context: { queryClient } }) {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({
        data: "/onboarding",
      });
      throw redirect({ href: signInUrl });
    }

    let organization: Organization | null = null;
    try {
      organization = await queryClient.ensureQueryData(
        activeOrganizationOptions(),
      );
    } catch {
      return { auth, organization: null };
    }

    if (organization?.metadata?.onboardingCompleted === "true") {
      throw redirect({ to: "/" });
    }

    return { auth, organization };
  },
  loader: async ({ context: { auth, organization } }) => {
    let githubInstalled = false;
    if (auth.organizationId) {
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

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

function OnboardingWizard() {
  const { githubInstalled, organization: initialOrganization } =
    Route.useLoaderData();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { data: organization } = useQuery({
    ...activeOrganizationOptions(),
    initialData: initialOrganization,
  });

  const hasOrganization = Boolean(organization);
  const organizationName = organization?.name ?? "";

  const [currentStep, setCurrentStep] = useState<Step>(() =>
    !hasOrganization ? "organization" : !githubInstalled ? "github" : "app",
  );
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
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-16">
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
          <div className="relative flex border border-border bg-card">
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
              const isClickable = i <= currentStepIndex;

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
                    isActive
                      ? "text-foreground"
                      : isComplete
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/50",
                  )}
                >
                  {isComplete ? (
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
                      hasOrganization={hasOrganization}
                      onComplete={goForward}
                    />
                  )}
                  {currentStep === "github" && (
                    <GitHubStep
                      installed={isGithubInstalled}
                      onInstalled={() => setIsGithubInstalled(true)}
                      onBack={goBack}
                      onComplete={goForward}
                      onSkip={goForward}
                    />
                  )}
                  {currentStep === "app" && (
                    <AppStep
                      onBack={goBack}
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
  hasOrganization,
  onComplete,
}: {
  user: { email: string };
  organizationName: string;
  hasOrganization: boolean;
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
      if (hasOrganization) {
        await updateOrganizationName({ data: { organizationName: orgName } });
      } else {
        await createOrganizationForCurrentUser({
          data: { organizationName: orgName },
        });
      }
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

    if (hasOrganization && orgName === organizationName) {
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
        className="mt-8 border border-border bg-card p-6 sm:p-10"
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
                    {JSON.stringify(field.state.meta.errors)}
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
                  {hasOrganization ? "Saving..." : "Creating..."}
                </>
              ) : hasOrganization ? (
                <>
                  Continue
                  <ArrowRight className="ml-2 size-3.5" />
                </>
              ) : (
                <>
                  Create & continue
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
  const [tabOpened, setTabOpened] = useState(false);

  useEffect(() => {
    if (!tabOpened || installed) return;

    const id = setInterval(async () => {
      try {
        const status = await getGithubAppInstallStatus();
        const isInstalled = Array.isArray(status)
          ? status.some((i) => i.status === "active")
          : Boolean(
              (status as { installed?: boolean } | null | undefined)?.installed,
            );
        if (isInstalled) {
          onInstalled();
          clearInterval(id);
        }
      } catch {
        // keep polling
      }
    }, 3000);

    return () => clearInterval(id);
  }, [tabOpened, installed, onInstalled]);

  function handleOpenInstall() {
    window.open("/api/github/install/start", "_blank", "noopener");
    setTabOpened(true);
  }

  return (
    <StepContainer title="Connect your repos" index={2}>
      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10"
      >
        {installed ? (
          <>
            <div className="flex flex-col items-center py-4">
              <motion.div
                className="flex size-12 items-center justify-center text-green-600 dark:text-green-400"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 15,
                }}
              >
                <Check className="size-8" strokeWidth={2.5} />
              </motion.div>
              <h2 className="mt-4 text-lg font-semibold">GitHub connected</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The Everr GitHub App is installed and syncing your repositories.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onBack}
              >
                <ArrowLeft className="mr-2 size-3.5" />
                Back
              </Button>
              <Button type="button" size="lg" onClick={onComplete}>
                Continue
                <ArrowRight className="ml-2 size-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">
              Install the Everr GitHub App
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sync workflow runs and logs from your repositories.
            </p>

            <div className="mt-8 space-y-4">
              <AnimatePresence>
                {tabOpened && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-center gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
                      <Loader2 className="size-4 shrink-0 animate-spin" />
                      <span>
                        Waiting for GitHub installation to complete&hellip;
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <Button
                type="button"
                size="lg"
                onClick={handleOpenInstall}
                className="w-full sm:w-auto"
              >
                <ExternalLink className="mr-2 size-3.5" />
                Install GitHub App
              </Button>
            </div>

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
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={onSkip}
                className="text-muted-foreground"
              >
                Skip for now
                <ArrowRight className="ml-2 size-3.5" />
              </Button>
            </div>
          </>
        )}
      </motion.section>
    </StepContainer>
  );
}

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

function AppStep({
  onBack,
  onFinish,
}: {
  onBack: () => void;
  onFinish: () => void;
}) {
  return (
    <StepContainer title="Get the desktop app" index={3}>
      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10"
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
                className="flex size-9 shrink-0 items-center justify-center border border-border bg-muted/50"
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
            Download for your platform
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {PLATFORMS.map((platform) => (
              <motion.a
                key={`${platform.os}-${platform.arch}`}
                href={getDownloadUrl(platform.os, platform.arch)}
                className="inline-flex h-10 items-center gap-2 border border-primary bg-primary/10 px-5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                <platform.icon className="size-3.5" />
                {platform.label}
              </motion.a>
            ))}
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
