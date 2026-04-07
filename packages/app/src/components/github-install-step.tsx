import { Button } from "@everr/ui/components/button";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { getGithubAppInstallStatus } from "@/data/onboarding";

interface GithubInstallStepProps {
  installed: boolean;
  onInstalled: () => void;
  onContinue: () => void;
  onSkip: () => void;
  onBack?: () => void;
}

export function GithubInstallStep({
  installed,
  onInstalled,
  onContinue,
  onSkip,
  onBack,
}: GithubInstallStepProps) {
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

  if (installed) {
    return (
      <>
        <div className="flex flex-col items-center py-4">
          <motion.div
            className="flex size-12 items-center justify-center text-green-400"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 15 }}
          >
            <Check className="size-8" strokeWidth={2.5} />
          </motion.div>
          <h2 className="mt-4 text-lg font-semibold">GitHub connected</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The Everr GitHub App is installed and syncing your repositories.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-border pt-6">
          {onBack ? (
            <Button type="button" variant="outline" size="lg" onClick={onBack}>
              <ArrowLeft className="mr-2 size-3.5" />
              Back
            </Button>
          ) : (
            <div />
          )}
          <Button type="button" size="lg" onClick={onContinue}>
            Continue
            <ArrowRight className="ml-2 size-3.5" />
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2 className="text-lg font-semibold">Install the Everr GitHub App</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Sync workflow runs and logs from your repositories. You can skip this
        and do it later with <code className="font-mono">everr init</code>.
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
              <div className="flex items-center gap-3 border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span>Waiting for GitHub installation to complete&hellip;</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Button
          type="button"
          size="lg"
          onClick={() => {
            window.open("/api/github/install/start", "_blank", "noopener");
            setTabOpened(true);
          }}
        >
          <ExternalLink className="mr-2 size-3.5" />
          Install GitHub App
        </Button>
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
        {onBack ? (
          <Button type="button" variant="outline" size="lg" onClick={onBack}>
            <ArrowLeft className="mr-2 size-3.5" />
            Back
          </Button>
        ) : (
          <div />
        )}
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
  );
}
