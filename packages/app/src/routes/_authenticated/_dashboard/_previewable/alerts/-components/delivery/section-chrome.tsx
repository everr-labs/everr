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
import { CardTitle } from "@everr/ui/components/card";
import { toneText } from "@everr/ui/components/tone";
import { cn } from "@everr/ui/lib/utils";
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
  errorClassName = "px-3 pb-3",
  children,
}: {
  isError: boolean;
  error: unknown;
  isPending: boolean;
  skeletonRows: number;
  /** Empty state, shown instead of children; omit to always render children. */
  empty?: { when: boolean; icon: ChannelIcon; title: string; hint: string };
  errorClassName?: string;
  children: React.ReactNode;
}) {
  if (isError) {
    return (
      <div className={errorClassName}>
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

export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <CardTitle>
      <h2>{children}</h2>
    </CardTitle>
  );
}

export function ConfirmDeleteAction({
  label,
  title,
  description,
  confirmLabel,
  pending,
  details,
  confirmDisabledReason,
  blockedAction,
  onConfirm,
}: {
  label: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  pending: boolean;
  details?: React.ReactNode;
  confirmDisabledReason?: string;
  blockedAction?: { label: string; onClick: () => void };
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
        {details}
        {confirmDisabledReason && (
          <div
            className={cn(
              "flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs",
              toneText({ tone: "warning" }),
            )}
          >
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <p>{confirmDisabledReason}</p>
          </div>
        )}
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
          <AlertDialogCancel disabled={pending}>
            {confirmDisabledReason ? "Close" : "Cancel"}
          </AlertDialogCancel>
          {confirmDisabledReason ? (
            blockedAction && (
              <AlertDialogAction
                onClick={() => {
                  setOpen(false);
                  requestAnimationFrame(blockedAction.onClick);
                }}
              >
                {blockedAction.label}
              </AlertDialogAction>
            )
          ) : (
            <AlertDialogAction
              variant="destructive"
              aria-busy={pending}
              disabled={pending}
              onClick={confirm}
            >
              {pending && (
                <LoaderCircle
                  aria-hidden
                  className="motion-safe:animate-spin"
                />
              )}
              {pending ? "Deleting..." : confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeleteOperations({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-3 text-xs">
      <div className="font-medium text-foreground">Changes</div>
      <ol className="list-decimal space-y-1 pl-4 text-muted-foreground marker:text-muted-foreground/70">
        {children}
      </ol>
    </div>
  );
}
