import { Button } from "@everr/ui/components/button";
import { RotateCw } from "lucide-react";
import { AuthSettingsSection } from "../auth/auth";
import {
  useCollectorStatusQuery,
  useRestartCollectorMutation,
} from "../local-telemetry/collector-status";
import { NotificationEmailsSection } from "../notifications/notification-emails-section";
import { SkillsSection } from "../skills/skills-section";
import { PageTitleBar } from "./title-bar";
import { SettingsSection } from "./ui";

function LocalTelemetrySection() {
  const statusQuery = useCollectorStatusQuery();
  const restartMutation = useRestartCollectorMutation();
  const status = statusQuery.data;

  return (
    <SettingsSection
      title="Local telemetry"
      description="Collector status and local endpoints used by Logs, Errors, and Traces."
      action={
        <Button
          type="button"
          variant="outline"
          disabled={restartMutation.isPending}
          onClick={() => restartMutation.mutate()}
        >
          <RotateCw data-icon="inline-start" />
          {restartMutation.isPending ? "Restarting" : "Restart collector"}
        </Button>
      }
    >
      <dl className="grid grid-cols-[4.5rem_1fr] items-center gap-x-6 gap-y-2.5 text-sm">
        <dt className="text-[var(--settings-text-muted)]">Status</dt>
        <dd className="m-0 flex items-center gap-2 text-[var(--settings-text)]">
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              status?.status === "running" ? "bg-emerald-500" : "bg-amber-400"
            }`}
            aria-hidden="true"
          />
          <span className="font-mono">
            {status?.status ?? (statusQuery.isPending ? "loading" : "unknown")}
          </span>
        </dd>
        {status?.reason ? (
          <>
            <dt className="self-start text-[var(--settings-text-muted)]">
              Reason
            </dt>
            <dd className="m-0 min-w-0 font-mono text-[var(--settings-text)]">
              {status.reason}
            </dd>
          </>
        ) : null}
        <dt className="text-[var(--settings-text-muted)]">OTLP</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-[var(--settings-text)]">
          {status?.otlpEndpoint ?? "unknown"}
        </dd>
        <dt className="text-[var(--settings-text-muted)]">SQL</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-[var(--settings-text)]">
          {status?.sqlEndpoint ?? "unknown"}
        </dd>
        <dt className="text-[var(--settings-text-muted)]">Health</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-[var(--settings-text)]">
          {status?.healthEndpoint ?? "unknown"}
        </dd>
        <dt className="self-start text-[var(--settings-text-muted)]">Data</dt>
        <dd className="m-0 min-w-0 break-all font-mono text-[var(--settings-text)]">
          {status?.telemetryDir ?? "unknown"}
        </dd>
      </dl>
    </SettingsSection>
  );
}

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Settings" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid divide-y divide-white/[0.08]">
          <AuthSettingsSection />
          <NotificationEmailsSection />
          <SkillsSection />
          <LocalTelemetrySection />
        </div>
      </div>
    </div>
  );
}
