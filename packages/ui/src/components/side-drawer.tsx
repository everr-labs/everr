import { Button } from "@everr/ui/components/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@everr/ui/components/drawer";
import { kickerClass } from "@everr/ui/lib/typography";
import { cn } from "@everr/ui/lib/utils";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A side panel for a narrow screen: the app sidebar, and the rails that leave
 * the layout below their breakpoint (Dashboards, Runbooks, the Explore
 * filters). It follows the finger and goes away with a swipe back towards its
 * edge, a tap on the dimmed page, Escape, or its close button.
 *
 * It is never the full width: a strip of the page stays visible, so it reads
 * as a panel over the page and leaves something to tap away.
 *
 * The popup carries `data-side-drawer`, so what renders inside can size itself
 * for touch with `in-data-side-drawer:` (rows grow to a 40px target) without
 * changing the wide layout.
 *
 * `--drawer-bleed-background` sets the surface, which the drawer also paints
 * past its edge while a swipe overshoots.
 */
export function SideDrawer({
  open,
  onOpenChange,
  side = "left",
  title,
  description,
  showTitle = true,
  closeLabel = "Close",
  initialFocus,
  className,
  dir,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "left" | "right";
  /** Names the panel. Shown as the header unless `showTitle` is false. */
  title: ReactNode;
  description?: ReactNode;
  /** False when the content brings its own header, e.g. the sidebar's logo:
   *  the title is then only announced, and the close button floats over the
   *  content's top-right corner. */
  showTitle?: boolean;
  closeLabel?: string;
  initialFocus?: React.ComponentProps<typeof DrawerContent>["initialFocus"];
  className?: string;
  dir?: string;
  children: ReactNode;
}) {
  const close = (
    <DrawerClose
      render={
        <Button
          variant="ghost"
          size="icon-lg"
          className={cn(
            "size-10 shrink-0 text-muted-foreground",
            !showTitle && "absolute top-3 right-2 z-10",
          )}
        />
      }
    >
      <XIcon />
      <span className="sr-only">{closeLabel}</span>
    </DrawerClose>
  );

  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection={side}>
      <DrawerContent
        dir={dir}
        data-side-drawer=""
        initialFocus={initialFocus}
        className={cn(
          "bg-(--drawer-bleed-background)",
          "[--drawer-content-width:min(var(--side-drawer-width,18rem),calc(100%-3.5rem))]!",
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          className,
        )}
      >
        {showTitle ? (
          <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-1 pl-3">
            <DrawerTitle className={cn(kickerClass, "flex items-center gap-2")}>
              {title}
            </DrawerTitle>
            {close}
          </div>
        ) : (
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
        )}
        {description && <DrawerDescription className="sr-only">{description}</DrawerDescription>}
        <div className="relative flex min-h-0 w-full flex-1 flex-col">
          {children}
          {!showTitle && close}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
