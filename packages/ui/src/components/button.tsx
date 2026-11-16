import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { Spinner } from "@everr/ui/components/spinner";
import { cn } from "@everr/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Children } from "react";
import type * as React from "react";

const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-primary aria-invalid:ring-destructive/40 aria-invalid:border-destructive/50 rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-[3px] aria-invalid:ring-2 [&_svg:not([class*='size-'])]:size-4 inline-flex items-center justify-center whitespace-nowrap press disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none shrink-0 [&_svg]:shrink-0 group/button select-none",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 disabled:not-data-loading:bg-white/[0.06] disabled:not-data-loading:text-muted-foreground disabled:not-data-loading:opacity-100",
        outline:
          "border-border bg-white/[0.035] hover:bg-white/[0.07] hover:border-white/[0.12] hover:text-foreground aria-expanded:bg-white/[0.07] aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-accent aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-white/[0.06] hover:text-foreground aria-expanded:bg-white/[0.07] aria-expanded:text-foreground",
        destructive:
          "bg-destructive/12 border-destructive/20 hover:bg-destructive/20 hover:border-destructive/30 focus-visible:ring-destructive/40 text-destructive focus-visible:border-destructive/40",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
        cta: "bg-primary text-primary-foreground hover:bg-primary/90 disabled:not-data-loading:bg-white/[0.06] disabled:not-data-loading:text-muted-foreground disabled:not-data-loading:opacity-100 font-heading uppercase tracking-widest font-bold",
      },
      size: {
        default:
          "h-8 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "h-5 gap-1 rounded-sm px-2 text-[0.625rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-2.5",
        sm: "h-7 gap-1 px-2 text-xs/relaxed has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        lg: "h-9 gap-1 px-2.5 text-xs/relaxed has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-4",
        xl: "h-14 gap-1.5 px-7.5 text-md",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  loading,
  status,
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Busy state. The label stays in the layout but fades out while a spinner
     *  fades in over it, so the button keeps its width and nothing around it
     *  moves. Pass it (true or false) only on buttons that can be busy. */
    loading?: boolean;
    /** How the last run ended. When loading stops with `success`, the spinner
     *  closes into a check before the label returns; with `error`, the button
     *  shakes once. Only read on buttons that pass `loading`. */
    status?: "success" | "error";
  }) {
  if (loading === undefined) {
    return (
      <ButtonPrimitive
        data-slot="button"
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </ButtonPrimitive>
    );
  }
  // Letters (and any icon) become separately animated items, so the label can
  // ripple out left to right. Screen readers get the label once, whole.
  let index = 0;
  const items = Children.toArray(children).map((child, runIndex) =>
    typeof child === "string" || typeof child === "number" ? (
      // One run per text child, so the button's gap separates an icon from
      // the text but never one letter from the next.
      // oxlint-disable-next-line react/no-array-index-key -- a label's children never reorder; position is their identity.
      <span key={runIndex} aria-hidden className="inline-flex whitespace-pre">
        {graphemes(String(child)).map((char) => (
          <span key={index} className="button-ripple-item" style={rippleIndex(index++)}>
            {char}
          </span>
        ))}
      </span>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- a label's children never reorder; position is their identity.
      <span key={runIndex} className="button-ripple-item inline-flex" style={rippleIndex(index++)}>
        {child}
      </span>
    ),
  );
  const text = Children.toArray(children)
    .filter((child) => typeof child === "string" || typeof child === "number")
    .join("");

  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading || undefined}
      // Set only once loading has stopped: its arrival is what plays the
      // success or error animation, once per run.
      data-status={loading ? undefined : status}
      aria-busy={loading || undefined}
      // A busy button is usually also disabled; it should read as working, not unavailable.
      className={cn(
        buttonVariants({ variant, size, className }),
        "relative overflow-hidden data-loading:disabled:opacity-100",
      )}
      {...props}
    >
      {text && <span className="sr-only">{text}</span>}
      <span className="inline-flex items-center justify-center gap-[inherit]">{items}</span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <Spinner className="button-spinner" />
      </span>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <svg viewBox="0 0 24 24" fill="none" className="button-success size-4">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="2.25"
            pathLength="100"
            className="button-success-ring"
          />
          <path
            d="M8 12.5l2.75 2.75L16 10"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength="100"
            className="button-success-check"
          />
        </svg>
      </span>
    </ButtonPrimitive>
  );
}

function rippleIndex(i: number) {
  const style: React.CSSProperties & Record<"--ripple-index", number> = { "--ripple-index": i };
  return style;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split by user-perceived character, so emoji and accents stay whole. */
function graphemes(text: string) {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

export { Button, buttonVariants };
