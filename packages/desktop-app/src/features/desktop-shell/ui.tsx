import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";

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
    <section className={cn("px-6 py-7 max-[620px]:px-5", compact && "py-5")}>
      {/* Constrain content to a left-aligned reading column so sections stay
          aligned and don't sprawl across a wide window; dividers stay full-bleed. */}
      <div className={cn("grid w-full max-w-[52rem] gap-4", compact && "gap-3")}>
        <div className="flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch">
          <div className="grid gap-1.5">
            <h2 className="m-0 text-[0.95rem] font-semibold tracking-[-0.01em]">{title}</h2>
            <p className="m-0 max-w-[60ch] text-[0.875rem] leading-6 text-[var(--settings-text-muted)]">
              {description}
            </p>
          </div>

          {action ? <div className="shrink-0 max-[620px]:w-full">{action}</div> : null}
        </div>

        {children}
      </div>
    </section>
  );
}

export function FeatureLoadingText({ text }: { text: string }) {
  return <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">{text}</p>;
}

export function FeatureErrorText({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">{message}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
