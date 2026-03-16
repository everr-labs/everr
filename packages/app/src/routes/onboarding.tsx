import { useForm, useStore } from "@tanstack/react-form";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { useAuth } from "@workos/authkit-tanstack-react-start/client";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Check,
  Download,
  ExternalLink,
  Loader2,
  Monitor,
  Terminal,
  Wrench,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OrganizationNameSchema } from "@/common/organization-name";
import { Button } from "@/components/ui/button";
import { getCurrentOrganization, updateOrganizationName } from "@/data/auth";
import {
  createOrganizationForCurrentUser,
  getGithubAppInstallStatus,
} from "@/data/onboarding";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ["organization", "github", "app"] as const;
type Step = (typeof STEPS)[number];

const STEP_META: Record<Step, { label: string }> = {
  organization: { label: "Organization" },
  github: { label: "GitHub" },
  app: { label: "Desktop App" },
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
    icon: Monitor,
  },
] as const;

function getDownloadUrl(os: string, arch: string) {
  return `${APP_DOWNLOAD_BASE}/everr-app-${os}-${arch}.dmg`;
}

// ---------------------------------------------------------------------------
// Motion variants
// ---------------------------------------------------------------------------

const SLIDE_OFFSET = 60;

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
  async beforeLoad() {
    // TODO: Move this to a layout route that wraps both the onboarding and the dashboard.
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({
        data: "/onboarding",
      });
      throw redirect({ href: signInUrl });
    }

    return {
      auth,
    };
  },
  loader: async ({ context: { auth } }) => {
    let githubInstalled = false;

    let organizationName = "";
    if (auth.organizationId) {
      try {
        const [status, org] = await Promise.all([
          getGithubAppInstallStatus(),
          getCurrentOrganization(),
        ]);
        githubInstalled = Array.isArray(status)
          ? status.some((i) => i.status === "active")
          : Boolean(
              (status as { installed?: boolean } | null | undefined)?.installed,
            );
        organizationName = org.name;
      } catch {
        // proceed with defaults
      }
    }

    return {
      hasOrganization: Boolean(auth.organizationId),
      githubInstalled,
      organizationName,
    };
  },
  component: OnboardingWizard,
});

// ---------------------------------------------------------------------------
// Step derivation
// ---------------------------------------------------------------------------

function deriveInitialStep(
  hasOrganization: boolean,
  githubInstalled: boolean,
): Step {
  if (!hasOrganization) return "organization";
  if (!githubInstalled) return "github";
  return "app";
}

// ---------------------------------------------------------------------------
// Wizard root
// ---------------------------------------------------------------------------

function OnboardingWizard() {
  const { hasOrganization, githubInstalled, organizationName } =
    Route.useLoaderData();
  const { user, loading: authLoading } = useAuth({ ensureSignedIn: true });
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState<Step>(() =>
    deriveInitialStep(hasOrganization, githubInstalled),
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

  const form = useForm({
    defaultValues: {
      organizationName,
      organizationCreated: hasOrganization,
      githubInstalled,
      githubSkipped: false,
    },
    onSubmit: async () => {
      await navigate({ to: "/dashboard" });
    },
  });

  if (authLoading) {
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
      {/* Dot grid */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.03]"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

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
              transition: { type: "spring", stiffness: 300, damping: 30 },
            },
          }}
          className="mb-12"
          aria-label="Onboarding progress"
        >
          <div className="relative flex items-stretch border border-border bg-card">
            {/* Animated active indicator */}
            <motion.div
              className="pointer-events-none absolute inset-y-0 bg-primary/[0.07]"
              initial={false}
              animate={{
                left: `${(currentStepIndex / STEPS.length) * 100}%`,
                width: `${100 / STEPS.length}%`,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
            {/* Bottom accent bar */}
            <motion.div
              className="pointer-events-none absolute bottom-0 h-0.5 bg-primary"
              initial={false}
              animate={{
                left: `${(currentStepIndex / STEPS.length) * 100}%`,
                width: `${100 / STEPS.length}%`,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />

            {STEPS.map((step, i) => {
              const isActive = i === currentStepIndex;
              const isComplete = i < currentStepIndex;
              const isClickable = i <= currentStepIndex;

              return (
                <button
                  key={step}
                  type="button"
                  onClick={() => isClickable && goTo(step)}
                  disabled={!isClickable}
                  className={`relative flex flex-1 items-center justify-center gap-2 px-3 py-3 text-xs font-medium outline-none transition-colors disabled:cursor-default ${
                    isActive
                      ? "text-foreground"
                      : isComplete
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/50"
                  }`}
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
                  <span className="tracking-wide">{STEP_META[step].label}</span>
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
              transition: { type: "spring", stiffness: 300, damping: 30 },
            },
          }}
        >
          <motion.div
            className="relative overflow-hidden"
            initial={false}
            animate={{ height: contentHeight }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
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
                  transition={{
                    type: "spring",
                    stiffness: 300,
                    damping: 30,
                  }}
                >
                  {currentStep === "organization" && (
                    <OrganizationStep
                      form={form}
                      user={user}
                      savedName={organizationName}
                      onComplete={goForward}
                    />
                  )}
                  {currentStep === "github" && (
                    <GitHubStep
                      form={form}
                      onBack={goBack}
                      onComplete={goForward}
                      onSkip={() => {
                        form.setFieldValue("githubSkipped", true);
                        goForward();
                      }}
                    />
                  )}
                  {currentStep === "app" && (
                    <AppStep
                      form={form}
                      onBack={goBack}
                      onFinish={() => void navigate({ to: "/dashboard" })}
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

// ---------------------------------------------------------------------------
// Form type helper
// ---------------------------------------------------------------------------

interface OnboardingFormValues {
  organizationName: string;
  organizationCreated: boolean;
  githubInstalled: boolean;
  githubSkipped: boolean;
}

function createFormInstance() {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- type-only helper, never called
  return useForm({
    defaultValues: {} as OnboardingFormValues,
    onSubmit: () => {},
  });
}

type FormInstance = ReturnType<typeof createFormInstance>;

// ---------------------------------------------------------------------------
// Step 1: Organization
// ---------------------------------------------------------------------------

function OrganizationStep({
  form,
  user,
  savedName,
  onComplete,
}: {
  form: FormInstance;
  user: { email?: string | null } | null;
  savedName: string;
  onComplete: () => void;
}) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastSavedName, setLastSavedName] = useState(savedName);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitting) return;

    const orgName = form.getFieldValue("organizationName");
    const parsed = OrganizationNameSchema.safeParse(orgName);
    if (!parsed.success) return;

    const alreadyCreated = form.getFieldValue("organizationCreated");
    const nameChanged = orgName !== lastSavedName;

    if (alreadyCreated && !nameChanged) {
      onComplete();
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      if (alreadyCreated && nameChanged) {
        await updateOrganizationName({
          data: { organizationName: orgName },
        });
      } else {
        await createOrganizationForCurrentUser({
          data: { organizationName: orgName },
        });
        form.setFieldValue("organizationCreated", true);
      }
      setLastSavedName(orgName);
      onComplete();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't finish setup. Please try again.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <motion.div variants={staggerContainer} initial="enter" animate="center">
      <motion.div variants={staggerItem}>
        <p className="text-center text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Step 1
        </p>
        <h1 className="mt-2 text-center text-3xl font-bold tracking-tight sm:text-4xl font-heading">
          Set up your workspace
        </h1>
        {user?.email && (
          <p className="mt-3 text-center text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">{user.email}</span>
          </p>
        )}
      </motion.div>

      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10"
      >
        <h2 className="text-lg font-semibold">Organization details</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your team's home on Everr. You can always change this later.
        </p>

        <form className="mt-8 space-y-5" onSubmit={(e) => void handleSubmit(e)}>
          <form.Field
            name="organizationName"
            validators={{
              onBlur: ({ value }) => {
                const parsed = OrganizationNameSchema.safeParse(value);
                return parsed.success
                  ? undefined
                  : parsed.error.issues[0]?.message;
              },
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <label
                  htmlFor="organization-name"
                  className="text-xs font-medium tracking-wide uppercase text-muted-foreground"
                >
                  Organization name
                </label>
                <input
                  id="organization-name"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="Acme Inc"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="organization"
                  className="border-input bg-background focus-visible:border-primary focus-visible:ring-primary/20 h-11 w-full border px-4 text-sm outline-none transition-all duration-200 focus-visible:ring-2"
                />
                <AnimatePresence>
                  {field.state.meta.errors.length > 0 && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="text-xs text-destructive overflow-hidden"
                      role="alert"
                    >
                      {field.state.meta.errors[0]}
                    </motion.p>
                  )}
                </AnimatePresence>
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
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  Creating...
                </>
              ) : form.getFieldValue("organizationCreated") ? (
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
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: GitHub
// ---------------------------------------------------------------------------

function GitHubStep({
  form,
  onBack,
  onComplete,
  onSkip,
}: {
  form: FormInstance;
  onBack: () => void;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const installed = useStore(form.store, (s) => s.values.githubInstalled);
  const [tabOpened, setTabOpened] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!tabOpened || installed) return;

    pollingRef.current = setInterval(async () => {
      try {
        const status = await getGithubAppInstallStatus();
        const isInstalled = Array.isArray(status)
          ? status.some((i) => i.status === "active")
          : Boolean(
              (status as { installed?: boolean } | null | undefined)?.installed,
            );
        if (isInstalled) {
          form.setFieldValue("githubInstalled", true);
          stopPolling();
        }
      } catch {
        // keep polling
      }
    }, 3000);

    return stopPolling;
  }, [tabOpened, installed, stopPolling, form]);

  function handleOpenInstall() {
    window.open("/api/github/install/start", "_blank", "noopener");
    setTabOpened(true);
  }

  return (
    <motion.div variants={staggerContainer} initial="enter" animate="center">
      <motion.div variants={staggerItem}>
        <p className="text-center text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Step 2
        </p>
        <h1 className="mt-2 text-center text-3xl font-bold tracking-tight sm:text-4xl font-heading">
          Connect your repos
        </h1>
      </motion.div>

      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10"
      >
        {installed ? (
          <>
            <div className="flex flex-col items-center py-4">
              <motion.div
                className="flex size-12 items-center justify-center border border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 15,
                }}
              >
                <Check className="size-5" strokeWidth={2.5} />
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
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: App Download
// ---------------------------------------------------------------------------

function AppStep({
  form: _form,
  onBack,
  onFinish,
}: {
  form: FormInstance;
  onBack: () => void;
  onFinish: () => void;
}) {
  const features = [
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
      icon: Wrench,
      title: "Integrate with your editor",
      description: "Cursor, Claude Code, Windsurf, and more",
    },
  ];

  return (
    <motion.div variants={staggerContainer} initial="enter" animate="center">
      <motion.div variants={staggerItem}>
        <p className="text-center text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Step 3
        </p>
        <h1 className="mt-2 text-center text-3xl font-bold tracking-tight sm:text-4xl">
          Get the desktop app
        </h1>
      </motion.div>

      <motion.section
        variants={staggerItem}
        className="mt-8 border border-border bg-card p-6 sm:p-10"
      >
        <h2 className="text-lg font-semibold">Get the most out of Everr</h2>

        <div className="mt-6 space-y-0 divide-y divide-border">
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              variants={staggerItem}
              className="flex items-start gap-4 py-4 first:pt-0 last:pb-0"
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
                <feature.icon className="size-4 text-muted-foreground" />
              </motion.div>
              <div className="text-sm">
                <span className="font-semibold">{feature.title}</span>{" "}
                <span className="text-muted-foreground">
                  {feature.description}
                </span>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <p className="text-xs font-medium tracking-wide uppercase text-muted-foreground">
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
                <Download className="size-3.5" />
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
    </motion.div>
  );
}
