import { cn } from "@everr/ui/lib/utils";

/** An arc that stretches and shrinks as it turns, over a faint track. Sized by
 *  `size-*` and coloured by `currentColor`, like an icon. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <svg
      data-slot="spinner"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={cn("animate-spinner-turn size-4 shrink-0", className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.25" opacity="0.18" />
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        pathLength="100"
        className="animate-spinner-arc"
      />
    </svg>
  );
}

export { Spinner };
