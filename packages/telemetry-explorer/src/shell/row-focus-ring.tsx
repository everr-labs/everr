/** Makes a list row the group its `RowFocusRing` reads its focus from. */
export const focusRingRow = "group/row";

/**
 * A row's focus ring: a button's ring, rounded and set in from the row's
 * edges, since a ring outside the row would be clipped by the rows around it.
 * An element and not a pseudo-element, so it also works in a table row, where
 * a `::before` becomes a cell. It shows while the row's link has keyboard
 * focus, and on any focus in the last opened row: browsers do not show
 * `:focus-visible` when focus comes back to it after a mouse click. It grows in
 * and out like an input's ring, with the same transition.
 */
export function RowFocusRing() {
  return (
    <span
      aria-hidden
      className="ring-primary pointer-events-none absolute inset-0.5 rounded-md ring-0 transition-[box-shadow] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] group-has-[a:focus-visible]/row:ring-2 group-data-last-opened/row:group-has-[a:focus]/row:ring-2"
    />
  );
}
