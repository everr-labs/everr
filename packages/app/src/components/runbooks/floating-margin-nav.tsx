import { cn } from "@everr/ui/lib/utils";
import type { ReactNode } from "react";
import { groupLabelClass } from "@/components/rail/rail-row";

/**
 * `@[67rem]/pane` is the reading column plus the nav beside it. Below it there
 * is no margin to float in and the pages nav lies down into a strip. Written
 * out at each use because Tailwind reads class names from the source text and
 * cannot follow an interpolated one.
 */
export const noMarginClass = "@[67rem]/pane:hidden";

/** One link in a floating nav: no surface of its own, so weight marks it. */
export const floatingLinkClass =
  "rounded-md py-1.5 text-[0.9375rem] text-muted-foreground leading-snug transition-colors hover:text-foreground";
export const floatingLinkActiveClass = "font-medium text-foreground";

/**
 * A nav that floats in the empty margin left of the reading column, taking
 * none of its width so the runbook stays centered. `inset-y-0 right-full` pins
 * it outside the column, and the list sticks inside that full-height box as
 * the pane scrolls.
 */
export function FloatingMarginNav({
  label,
  ariaLabel,
  children,
}: {
  /** The heading over the list. */
  label: string;
  /** Overrides the accessible name where the heading is too terse alone. */
  ariaLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="absolute inset-y-0 hidden pr-5 @[67rem]/pane:block right-full">
      <nav
        aria-label={ariaLabel ?? label}
        className="sticky top-3 flex w-40 flex-col gap-1 @[76rem]/pane:w-44 @[88rem]/pane:w-52"
      >
        <span className={cn(groupLabelClass, "mb-1 px-2")}>{label}</span>
        {children}
      </nav>
    </div>
  );
}
