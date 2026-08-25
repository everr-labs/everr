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
import { CirclePause, Play } from "lucide-react";

const PAUSE_CONSEQUENCE =
  "It stops being evaluated, so it cannot fire or resolve while paused. Anything it would have caught passes unnoticed.";

/**
 * Only the pause confirms. Its cost is silent, because nothing fires to
 * remind you later, while a resume shows its own effect.
 */
export function AlertingPauseToggle({
  paused,
  pending,
  name,
  variant = "ghost",
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  name: string;
  /** "ghost" in a table row, "outline" beside a page heading. */
  variant?: "ghost" | "outline";
  onToggle: () => void;
}) {
  const size = variant === "ghost" ? ("sm" as const) : undefined;

  if (paused) {
    return (
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={onToggle}
      >
        <Play data-icon="inline-start" />
        Resume
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        // Destructive beside a page heading, where it is the one pause on
        // screen. In a row it repeats down the whole table, and the red would
        // outweigh the state column the table exists to show. Rows stay quiet,
        // and the confirm dialog carries the weight.
        render={
          <Button
            variant={variant === "outline" ? "destructive" : variant}
            size={size}
            disabled={pending}
          />
        }
      >
        <CirclePause data-icon="inline-start" />
        Pause
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {PAUSE_CONSEQUENCE} Resuming picks evaluation back up from the live
            data at that moment; the gap is not backfilled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onToggle}>
            Pause rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
