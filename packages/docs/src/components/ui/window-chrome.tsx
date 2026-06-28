import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";

/** Size presets scale the traffic lights and the title together. `sm` suits the
 *  compact feature illustrations; `md` suits the larger editor mockups. */
const SIZES = {
  sm: {
    dot: "size-2",
    label:
      "text-[9px] tracking-[0.05em] text-fd-muted-foreground/50 sm:text-[10px]",
  },
  md: {
    dot: "size-2.5",
    label: "text-[11px] text-fd-muted-foreground",
  },
} as const;

const DOT = "rounded-full border border-fd-border bg-fd-muted-foreground/20";

type WindowChromeProps = {
  /** File path or run label shown next to the traffic lights. */
  title?: ReactNode;
  /** Right-aligned content (a run time, a diff stat). Strings get the title's
   *  monospace styling; nodes are slotted as-is. */
  trailing?: ReactNode;
  size?: keyof typeof SIZES;
  /** Show the three traffic-light dots. Off reads as a plain file header. */
  dots?: boolean;
  /** Container override, e.g. a translucent background. */
  className?: string;
};

/** Faux window/editor title bar: three traffic lights, a title, and optional
 *  trailing content. Shared by the feature illustrations, the Perses bento
 *  editor, and the agents section. */
export function WindowChrome({
  title,
  trailing,
  size = "md",
  dots = true,
  className,
}: WindowChromeProps) {
  const s = SIZES[size];
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b border-fd-border bg-fd-card px-3 py-2",
        className,
      )}
    >
      {dots ? (
        <>
          <span className={cn(DOT, s.dot)} />
          <span className={cn(DOT, s.dot)} />
          <span className={cn(DOT, s.dot)} />
        </>
      ) : null}
      {title != null ? (
        <span className={cn("truncate font-mono", dots && "ml-2", s.label)}>
          {title}
        </span>
      ) : null}
      {trailing == null ? null : typeof trailing === "string" ? (
        <span
          className={cn("ml-auto shrink-0 font-mono tabular-nums", s.label)}
        >
          {trailing}
        </span>
      ) : (
        <span className="ml-auto shrink-0">{trailing}</span>
      )}
    </div>
  );
}
