import { Button } from "@everr/ui/components/button";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getGithubAppInstallStatus } from "@/data/github";

export function GithubInstall({
  installed,
  onInstalled,
}: {
  installed: boolean;
  onInstalled: () => void;
}) {
  const [waitingForInstallation, setWaitingForInstallation] = useState(false);

  useEffect(() => {
    if (!waitingForInstallation || installed) return;

    const interval = window.setInterval(async () => {
      try {
        const installations = await getGithubAppInstallStatus();
        if (installations.some((installation) => installation.installed)) {
          setWaitingForInstallation(false);
          onInstalled();
        }
      } catch {
        // Keep polling while the GitHub installation window is open.
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [installed, onInstalled, waitingForInstallation]);

  if (installed) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
            <Check className="size-5" />
          </span>
          <div>
            <p className="font-medium text-sm">GitHub connected</p>
            <p className="text-muted-foreground text-sm">
              Workflow events are synced for this organization.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            window.open("/api/github/install/start", "_blank", "noopener");
            setWaitingForInstallation(true);
          }}
        >
          <ExternalLink />
          Update installation
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-sm">Connect the Everr GitHub App</p>
        <p className="mt-1 text-muted-foreground text-sm">
          Choose the repositories Everr can read to import workflow history and
          receive future GitHub Actions runs.
        </p>
      </div>

      {waitingForInstallation ? (
        <div className="flex items-center gap-2 border border-amber-500/30 bg-amber-500/5 p-3 text-amber-500 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Waiting for the GitHub installation to complete...
        </div>
      ) : null}

      <Button
        type="button"
        onClick={() => {
          window.open("/api/github/install/start", "_blank", "noopener");
          setWaitingForInstallation(true);
        }}
      >
        <ExternalLink />
        Install GitHub App
      </Button>
    </div>
  );
}
