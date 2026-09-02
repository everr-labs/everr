import { cn } from "@everr/ui/lib/utils";

/**
 * One band of the alert detail panel. Lives on its own so the sections that
 * grew past a screenful (silences, and whatever follows it) can be their own
 * files without importing back through the panel that renders them.
 */
export function Section({
  title,
  aside,
  /** Runs the content edge to edge, keeping the padding on the heading only.
   *  A chart with a value axis wants the whole width; the same idiom the panel
   *  registry calls `flush-content`. */
  flush,
  children,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("border-t py-4", !flush && "px-3")}>
      <div
        className={cn(
          "mb-2.5 flex items-baseline justify-between gap-3",
          flush && "px-3",
        )}
      >
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
