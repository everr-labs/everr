import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Switch } from "@everr/ui/components/switch";

/**
 * The view of each category. The "Consent Settings" button of the banner shows
 * it. Refer to `ConsentBanner`. This component only shows the view, the same as
 * the banner. The app selects the store for `analyticsEnabled`, and it applies
 * that value to the telemetry.
 *
 * There are two rows only. The Essential row is always on, and thus it is not a
 * choice. The Analytics row is the only category that controls a function of
 * this product. You can add more categories here when a different function needs
 * its own consent. A control that changes nothing is worse than no control.
 */
function ConsentSettingsDialog({
  open,
  onOpenChange,
  analyticsEnabled,
  onAnalyticsChange,
  onDeny,
  onAcceptAll,
  onSave,
  description = "This site uses tracking technologies. You may opt in or opt out of the use of these technologies.",
  privacyPolicyHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analyticsEnabled: boolean;
  onAnalyticsChange: (enabled: boolean) => void;
  onDeny: () => void;
  onAcceptAll: () => void;
  onSave: () => void;
  description?: string;
  privacyPolicyHref?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your Privacy</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="ring-foreground/10 divide-foreground/10 flex flex-col divide-y rounded-lg ring-1">
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <span>Essential</span>
            <Switch checked disabled aria-label="Essential (always on)" />
          </div>
          <div className="flex items-center justify-between gap-4 px-3 py-2.5">
            <span>Analytics</span>
            <Switch
              checked={analyticsEnabled}
              onCheckedChange={onAnalyticsChange}
              aria-label="Analytics"
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onDeny}>
              Deny
            </Button>
            <Button variant="outline" size="sm" onClick={onAcceptAll}>
              Accept all
            </Button>
          </div>
          <Button size="sm" onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
        {privacyPolicyHref && (
          <p className="text-muted-foreground text-xs/relaxed">
            Read how we handle your data in our{" "}
            <a
              href={privacyPolicyHref}
              className="underline underline-offset-3 hover:text-foreground"
            >
              Privacy Policy
            </a>
            .
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export { ConsentSettingsDialog };
