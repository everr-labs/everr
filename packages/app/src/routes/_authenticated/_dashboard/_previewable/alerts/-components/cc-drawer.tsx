// packages/app/src/routes/_authenticated/_dashboard/_previewable/alerts/-components/cc-drawer.tsx
//
// The alerting section's create/edit surface: a right-side drawer (Base UI
// dialog via @everr/ui's Sheet) instead of a centered modal, so the page —
// notably the Delivery pipeline — stays visible while editing. One shared
// scaffold keeps header/body/footer density identical across builders.
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@everr/ui/components/sheet";
import type { ReactNode } from "react";

export function CcDrawer({
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
        className="gap-0 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border/60 p-4">
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">{children}</div>
        <SheetFooter className="flex-row justify-end border-t border-border/60 p-4">
          {footer}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
