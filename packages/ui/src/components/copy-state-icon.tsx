import { cn } from "@everr/ui/lib/utils";
import { CopyIcon } from "lucide-react";

const ICON_SWAP =
  "col-start-1 row-start-1 transition-[scale,opacity,filter] duration-200 ease-out motion-reduce:transition-[opacity]";

// The states roll: the old one lifts out as the new one rises in, so the swap
// reads as a change rather than a flicker. Without motion it only fades.
const LABEL_SWAP =
  "col-start-1 row-start-1 inline-flex items-center gap-[inherit] transition-[translate,opacity,filter] duration-200 ease-out motion-reduce:transition-[opacity] motion-reduce:translate-y-0";

/** Copy icon that gives way to a check once the value is copied. The copy icon
 *  shrinks and blurs out while the check draws itself in, the same stroke the
 *  button's success state draws, without the ring that says "saved". Both
 *  stay mounted, so the swap runs in both directions. */
function CopyStateIcon({
  copied,
  className,
  iconClassName,
  ...props
}: React.ComponentProps<"span"> & { copied: boolean; iconClassName?: string }) {
  return (
    <span
      data-slot="copy-state-icon"
      className={cn("inline-grid shrink-0 place-items-center", className)}
      {...props}
    >
      <CopyIcon
        aria-hidden
        className={cn(
          ICON_SWAP,
          copied ? "scale-50 opacity-0 blur-[2px]" : "scale-100 opacity-100 blur-none",
          iconClassName,
        )}
      />
      <DrawnCheck drawn={copied} className={cn("col-start-1 row-start-1", iconClassName)} />
    </span>
  );
}

/** A copy button's icon and label, and its "Copied" confirmation, as two
 *  stacked states that roll into each other: the copy state lifts out as the
 *  check draws in beside "Copied". Each state is centred in the space of the
 *  wider one, so the button never changes size and either state sits in its
 *  middle. */
function CopyStateContent({
  copied,
  label,
  copiedLabel = "Copied",
  iconClassName,
  labelClassName,
}: {
  copied: boolean;
  label: React.ReactNode;
  copiedLabel?: React.ReactNode;
  iconClassName?: string;
  /** For the text only, e.g. to hide it on narrow screens and keep the icon. */
  labelClassName?: string;
}) {
  return (
    <span
      data-slot="copy-state-content"
      className="inline-grid justify-items-center gap-[inherit] overflow-hidden"
    >
      <span
        aria-hidden={copied || undefined}
        className={cn(
          LABEL_SWAP,
          copied ? "-translate-y-2 opacity-0 blur-[2px]" : "translate-y-0 opacity-100 blur-none",
        )}
      >
        <CopyIcon aria-hidden className={cn("shrink-0", iconClassName)} />
        <span className={labelClassName}>{label}</span>
      </span>
      <span
        aria-hidden={!copied || undefined}
        className={cn(
          LABEL_SWAP,
          copied ? "translate-y-0 opacity-100 blur-none" : "translate-y-2 opacity-0 blur-[2px]",
        )}
      >
        <DrawnCheck drawn={copied} className={cn("shrink-0", iconClassName)} />
        <span className={labelClassName}>{copiedLabel}</span>
      </span>
    </span>
  );
}

export { CopyStateContent, CopyStateIcon };

/** Lucide's check, drawn by hand so its stroke can be animated, and in writing
 *  order: the short stroke first, as the button's success check does. */
function DrawnCheck({ drawn, className }: { drawn: boolean; className?: string }) {
  return (
    <svg
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path
        d="M4 12l5 5L20 6"
        pathLength={100}
        className={cn(
          "transition-[stroke-dasharray,opacity] ease-out motion-reduce:transition-[opacity] motion-reduce:[stroke-dasharray:100_0]",
          // In: drawn after the copy icon has started to leave. Out: a quick
          // fade, so the copy icon is not waiting on it.
          drawn
            ? "opacity-100 [stroke-dasharray:100_0] duration-300 delay-75"
            : "opacity-0 [stroke-dasharray:0_100] duration-150",
        )}
      />
    </svg>
  );
}
