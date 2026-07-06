// packages/app/src/components/segmented-tabs.tsx
//
// The one in-page tab idiom: a bordered pill row where the active segment
// reads as a raised card. Segments render as router <Link>s (via `render`)
// where the call site navigates, and as buttons where they switch local state.
import { cn } from "@everr/ui/lib/utils";
import { cloneElement, type ReactElement, type ReactNode } from "react";

export function SegmentedTabs({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex w-fit rounded-md border border-border bg-muted/20 p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SegmentedTab({
  active,
  render,
  onClick,
  children,
}: {
  active: boolean;
  /** Rendered element (e.g. a router <Link>) when the tab navigates. */
  render?: ReactElement<Record<string, unknown>>;
  onClick?: () => void;
  children: ReactNode;
}) {
  const props = {
    role: "tab",
    "aria-selected": active,
    className: cn(
      "rounded-[0.3rem] px-3 py-1 text-xs font-medium outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] focus-visible:outline-primary",
      active
        ? "bg-card text-foreground ring-1 ring-foreground/10"
        : "text-muted-foreground hover:text-foreground",
    ),
    children,
  };
  if (render) return cloneElement(render, props);
  return <button type="button" onClick={onClick} {...props} />;
}
