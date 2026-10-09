import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import type { ReactNode } from "react";

export function DetailRouteDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => Promise<unknown> | undefined;
}) {
  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        if (!next) void onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] w-[90vw] max-w-none gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
