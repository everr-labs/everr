import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

/**
 * A fixed, bottom-of-viewport analytics consent prompt: presentational only.
 * The host app owns the consent decision (where it's persisted, how it
 * drives telemetry init), this just renders the choice and reports it back.
 * `open` is controlled by the host so it can stay hidden during SSR until
 * the stored decision (or lack of one) is known, avoiding a flash of the
 * banner for returning visitors. Pass `onOpenSettings` to also show a
 * "Consent Settings" action (pair with `ConsentSettingsDialog` for the
 * per-category view); omit it for a plain accept/deny prompt.
 */
function ConsentBanner({
  open,
  onAcceptAll,
  onDeny,
  onOpenSettings,
  title = "We use analytics cookies",
  description = "We'd like to use cookies to understand how the product is used and improve it. You can change your mind at any time.",
  className,
  ...props
}: {
  open: boolean;
  onAcceptAll: () => void;
  onDeny: () => void;
  onOpenSettings?: () => void;
  title?: string;
  description?: string;
} & Omit<React.ComponentProps<"section">, "children">) {
  if (!open) return null;

  return (
    <section
      data-slot="consent-banner"
      aria-label={title}
      className={cn(
        "bg-card text-card-foreground ring-foreground/10 animate-in slide-in-from-bottom-4 fade-in fixed inset-x-0 bottom-0 z-50 flex flex-col items-start gap-3 rounded-t-lg p-4 text-xs/relaxed shadow-lg ring-1 duration-200 sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm sm:rounded-lg",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{description}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 self-end">
        {onOpenSettings && (
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            Consent Settings
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onDeny}>
          Deny
        </Button>
        <Button variant="default" size="sm" onClick={onAcceptAll}>
          Accept all
        </Button>
      </div>
    </section>
  );
}

export { ConsentBanner };
