import { Button } from "@everr/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@everr/ui/components/empty";
import { RotateCw } from "lucide-react";

export function RetryError({
  title,
  message,
  onRetry,
  variant = "empty",
}: {
  title?: string;
  message: string;
  onRetry: () => void;
  /** "empty" centers a full placeholder; "inline" is a one-line alert strip. */
  variant?: "empty" | "inline";
}) {
  if (variant === "inline") {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
      >
        <span>{title ? `${title}: ${message}` : message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw data-icon="inline-start" />
          Retry
        </Button>
      </div>
    );
  }
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </Empty>
  );
}
