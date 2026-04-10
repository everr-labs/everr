import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@everr/ui/components/card";
import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

export function DesktopFrame({
  title,
  description,
  headerAction,
  children,
}: {
  title: string;
  description: string;
  headerAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9" />
      <Card className="w-full max-w-[860px] overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
        <CardHeader className="gap-5 px-6 pb-0 pt-8 max-[620px]:px-5">
          <div className="flex items-start justify-between gap-4 max-[720px]:flex-col">
            <div className="grid gap-1.5">
              <p className="m-0 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--settings-text-soft)]">
                {APP_DISPLAY_NAME}
              </p>
              <h1 className="m-0 text-[clamp(2rem,5vw,2.8rem)] font-medium leading-none tracking-[-0.04em]">
                {title}
              </h1>
              <CardDescription className="max-w-[52ch] text-[0.95rem] leading-6 text-[var(--settings-text-muted)]">
                {description}
              </CardDescription>
            </div>
            {headerAction ? (
              <div className="shrink-0">{headerAction}</div>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="grid gap-0 px-0">{children}</CardContent>
      </Card>
    </main>
  );
}

export function DesktopLoadingState({ text }: { text: string }) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <section className="flex min-h-screen items-center justify-center px-6 py-14">
        <Card className="w-full max-w-[420px] border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
          <CardContent className="grid place-items-center px-6 py-12">
            <p className="m-0 text-sm text-[var(--settings-text-muted)]">
              {text}
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

interface SettingsSectionProps {
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}
export function SettingsSection({
  title,
  description,
  action,
  children,
  compact = false,
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        "grid gap-4 px-6 py-5 max-[620px]:px-5",
        compact && "gap-3 py-4",
      )}
    >
      <div className="flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch">
        <div className="grid gap-1.5">
          <h2 className="m-0 text-[1rem] font-semibold">{title}</h2>
          <p className="m-0 max-w-[46ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            {description}
          </p>
        </div>

        {action ? (
          <div className="shrink-0 max-[620px]:w-full">{action}</div>
        ) : null}
      </div>

      {children}
    </section>
  );
}

export function WizardStepSection({
  title,
  description,
  badge,
  action,
  children,
}: {
  title: string;
  description: string;
  badge: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4 max-[620px]:flex-col">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[1.05rem] font-semibold">{title}</h2>
            {badge}
          </div>
          <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
            {description}
          </p>
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {children}
    </div>
  );
}

export function FeatureLoadingText({ text }: { text: string }) {
  return (
    <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
      {text}
    </p>
  );
}

export function FeatureErrorText({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
        {message}
      </p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
