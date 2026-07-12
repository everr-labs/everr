// packages/app/src/components/cc/pause-rule-button.tsx
//
// The one pause/resume control for alert rules. Pausing is quiet-by-default
// dangerous (a paused rule looks exactly like a healthy quiet one), so the
// pause direction always spells out its consequences in a confirm dialog;
// resuming is safe and immediate.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Button } from "@everr/ui/components/button";
import { Pause, Play } from "lucide-react";

export function PauseRuleButton({
  name,
  paused,
  pending,
  onPause,
  onResume,
  variant = "outline",
  size = "default",
  longLabels = false,
}: {
  /** The rule's display name, quoted in the confirm dialog. */
  name: string;
  paused: boolean;
  pending: boolean;
  onPause: () => void;
  onResume: () => void;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
  /** "Pause evaluation" instead of "Pause" where space allows (detail page). */
  longLabels?: boolean;
}) {
  if (paused) {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={onResume}
        title="Resume evaluation"
      >
        <Play data-icon="inline-start" />
        {longLabels ? "Resume evaluation" : "Resume"}
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant={variant}
            size={size}
            disabled={pending}
            title="Pause evaluation"
          />
        }
      >
        <Pause data-icon="inline-start" />
        {longLabels ? "Pause evaluation" : "Pause"}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause evaluation of “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The engine stops running this rule&rsquo;s query on its schedule. No
            new alerts fire, existing instances stop updating, and nothing
            notifies until you resume. The rule definition itself is untouched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep evaluating</AlertDialogCancel>
          <AlertDialogAction onClick={onPause}>
            Pause evaluation
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
