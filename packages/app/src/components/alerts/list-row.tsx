/**
 * The row idiom the alerting lists share: the whole row is a pointer
 * convenience that opens the rule, and the rule's name inside it is the real
 * control, so keyboard and screen-reader users get one clear target rather
 * than a click handler they cannot reach.
 */
import { cn } from "@everr/ui/lib/utils";

/** The look of the one focusable target in a row: the rule's name. Also worn
 *  by the Silences page's rule links, which open the same panel. */
export const ROW_TARGET =
  "truncate text-left outline-2 outline-dotted outline-transparent hover:underline focus-visible:outline-primary";

export function SelectableRow({
  selected,
  onOpen,
  className,
  children,
}: {
  selected: boolean;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only row convenience, the RowTarget inside is the real button
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only row convenience, the RowTarget inside is the real button
    <div
      onClick={onOpen}
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/25",
        selected && "bg-muted/40",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The row's real control. Stops the click so the row does not open twice. */
export function RowTarget({
  onOpen,
  title,
  className,
  children,
}: {
  onOpen: () => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className={cn(ROW_TARGET, className)}
    >
      {children}
    </button>
  );
}
