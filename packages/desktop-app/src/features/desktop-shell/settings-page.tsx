import { Button } from "@everr/ui/components/button";
import { RotateCw } from "lucide-react";
import { AuthSettingsSection } from "../auth/auth";
import {
  useCollectorStatusQuery,
  useRestartCollectorMutation,
} from "../local-telemetry/collector-status";
import { NotificationEmailsSection } from "../notifications/notification-emails-section";
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
      <dl className="grid max-w-[680px] grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-[var(--settings-text-muted)]">Status</dt>
        <dd className="m-0 font-mono text-[var(--settings-text)]">
          {status?.status ?? (statusQuery.isPending ? "loading" : "unknown")}
        </dd>
        {status?.reason ? (
          <>
            <dt className="text-[var(--settings-text-muted)]">Reason</dt>
            <dd className="m-0 min-w-0 truncate font-mono text-[var(--settings-text)]">
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
        <dt className="text-[var(--settings-text-muted)]">Data</dt>
        <dd className="m-0 min-w-0 truncate font-mono text-[var(--settings-text)]">
          {status?.telemetryDir ?? "unknown"}
        </dd>
      </dl>
    </SettingsSection>
  );
}

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch pl-[var(--titlebar-inset)]"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            Settings
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid divide-y divide-white/[0.06]">
          <div className="pt-0">
            <AuthSettingsSection />
          </div>
          <NotificationEmailsSection />
          <LocalTelemetrySection />
        </div>
      </div>
    </div>
  );
}
