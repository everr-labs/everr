/**
 * The row idiom the alerting lists share: the whole row is a pointer
 * convenience that opens the rule, and the rule's name inside it is the real
 * control, so keyboard and screen-reader users get one clear target rather
 * than a click handler they cannot reach. The target has no handler of its
 * own: a click on it, from a pointer or from Enter on the focused button,
 * bubbles to the row, so the row is the one place that opens.
 */
import { cn } from "@everr/ui/lib/utils";

/** The look of the one focusable target in a row: the rule's name. Also worn
 *  by the Silences page's rule links, which open the same panel.
 *
 *  No underline on hover. The row washes under the pointer already, and a rule
 *  that both highlighted its row and underlined its name was answering one
 *  gesture twice. The focus ring stays: keyboard focus has no row wash to
 *  lean on. */
export const ROW_TARGET =
  "truncate text-left outline-2 outline-dotted outline-transparent focus-visible:outline-primary";

/** The wash a row wears while the pointer is over it. Shared so the lists that
 *  open the same panel cannot drift onto two different ones. */
export const ROW_HOVER = "transition-colors hover:bg-muted/25";

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
        "cursor-pointer",
        ROW_HOVER,
        selected && "bg-muted/40",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The row's real control. Must sit inside a `SelectableRow`. */
export function RowTarget({
  title,
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button type="button" title={title} className={cn(ROW_TARGET, className)}>
      {children}
    </button>
  );
}
