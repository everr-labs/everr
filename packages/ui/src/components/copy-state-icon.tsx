import { cn } from "@everr/ui/lib/utils";
import { CheckIcon, CopyIcon } from "lucide-react";

const ICON_SWAP =
  "col-start-1 row-start-1 transition-[scale,opacity,filter] duration-200 ease-out motion-reduce:transition-[opacity]";

/** Copy icon that cross-fades into a check once the value is copied. Both
 *  icons stay mounted, so the swap can animate in both directions. */
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
      <CheckIcon
        aria-hidden
        className={cn(
          ICON_SWAP,
          copied ? "scale-100 opacity-100 blur-none" : "scale-50 opacity-0 blur-[2px]",
          iconClassName,
        )}
      />
    </span>
  );
}

export { CopyStateIcon };
