import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import type * as React from "react";

/**
 * A prompt for the analytics consent. It stays at the bottom of the window. This
 * component only shows the prompt. The app owns the consent decision: it selects
 * the store for that decision, and it applies the decision to the telemetry.
 * This component shows the choice and gives the answer of the user to the app.
 *
 * The app controls the `open` property. Thus the banner can stay hidden during
 * the SSR, until the app knows the decision in the store or knows that there is
 * no decision. Then the banner does not appear and disappear for a visitor who
 * comes again.
 *
 * Give the `onOpenSettings` property to also show a "Consent Settings" button.
 * Use `ConsentSettingsDialog` with it for the view of each category. Without
 * that property, the banner shows only the accept button and the deny button.
 */
function ConsentBanner({
  open,
  onAcceptAll,
  onDeny,
  onOpenSettings,
  title = "We use analytics",
  description = "We'd like to store analytics data in your browser to understand how the product is used and improve it. You can change your mind at any time.",
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
