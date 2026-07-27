// The health vocabulary, and the one place it turns into colour.
//
// Amber is "attention" (a warning severity, degraded health, a budget running
// low), red is "emergency" (firing critical, exhausted), emerald is healthy.
// Signal Lime (`primary`) stays reserved for live/selected, so it is only the
// `live` tone. Every readout — dots, status words, meters, figures — resolves
// through here instead of repeating the class strings, which keeps a palette
// change to a single edit.
import { cva } from "class-variance-authority";

export type Tone = "danger" | "warning" | "healthy" | "live" | "muted";

export const toneText = cva("", {
  variants: {
    tone: {
      danger: "text-destructive",
      warning: "text-amber-600 dark:text-amber-400",
      healthy: "text-emerald-600 dark:text-emerald-400",
      live: "text-foreground",
      muted: "text-muted-foreground",
    },
    /** Firing and exhausted states carry weight as well as colour. */
    emphasis: { strong: "font-medium", normal: "" },
  },
  defaultVariants: { emphasis: "normal" },
});

export const toneDot = cva("", {
  variants: {
    tone: {
      danger: "bg-destructive",
      warning: "bg-amber-500",
      healthy: "bg-emerald-500",
      live: "bg-primary",
      muted: "bg-muted-foreground/50",
    },
  },
});
