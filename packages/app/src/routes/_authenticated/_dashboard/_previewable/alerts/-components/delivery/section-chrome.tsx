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
import { LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import {
  AlertingEmptyState,
  AlertingTableSkeleton,
} from "../common/placeholders";
import {
  AlertingQueryError,
  alertingErrorMessage,
} from "../common/query-error";
import type { ChannelIcon } from "./channel-meta";

export function SectionBody({
  isError,
  error,
  isPending,
  skeletonRows,
  empty,
  children,
}: {
  isError: boolean;
  error: unknown;
  isPending: boolean;
  skeletonRows: number;
  /** Empty state, shown instead of children; omit to always render children. */
  empty?: { when: boolean; icon: ChannelIcon; title: string; hint: string };
  children: React.ReactNode;
}) {
  if (isError) {
    return (
      <div className="px-3 pb-3">
        <AlertingQueryError error={error} />
      </div>
    );
  }
  if (isPending) return <AlertingTableSkeleton rows={skeletonRows} />;
  if (empty?.when) {
    return (
      <AlertingEmptyState
        icon={empty.icon}
        title={empty.title}
        hint={empty.hint}
      />
    );
  }
  return <>{children}</>;
}

export function ConfirmDeleteAction({
  label,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const setDialogOpen = (nextOpen: boolean) => {
    if (pending) return;
    if (nextOpen) setFailure(null);
    setOpen(nextOpen);
  };

  const confirm = async () => {
    setFailure(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      setFailure(alertingErrorMessage(error));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setDialogOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="size-10 text-muted-foreground hover:text-destructive sm:size-8"
            aria-label={label}
            disabled={pending}
          />
        }
      >
        <Trash2 />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {failure && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <div>
              <p className="font-medium">Deletion did not finish</p>
              <p className="mt-0.5 opacity-80">{failure}</p>
              <p className="mt-1 text-muted-foreground">
                Review the current configuration before trying again.
              </p>
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            aria-busy={pending}
            disabled={pending}
            onClick={confirm}
          >
            {pending && (
              <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
            )}
            {pending ? "Deleting..." : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
