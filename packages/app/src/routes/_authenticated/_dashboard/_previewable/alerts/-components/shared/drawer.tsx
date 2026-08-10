import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@everr/ui/components/sheet";
import type { ReactNode } from "react";

export function AlertingDrawer({
  open,
  onOpenChange,
  title,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border/60 p-4">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
        <SheetFooter className="flex-col-reverse justify-end border-t border-border/60 p-4 sm:flex-row [&_[data-slot=button]]:h-10 [&_[data-slot=button]]:w-full sm:[&_[data-slot=button]]:h-8 sm:[&_[data-slot=button]]:w-auto">
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
