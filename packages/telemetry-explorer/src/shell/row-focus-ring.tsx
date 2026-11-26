/** Makes a list row the group its `RowFocusRing` reads its focus from. */
export const focusRingRow = "focus-ring-row";

/**
 * A row's focus ring: a button's ring, rounded and set in from the row's
 * edges, since a ring outside the row would be clipped by the rows around it.
 * An element and not a pseudo-element, so it also works in a table row, where
 * a `::before` becomes a cell. It shows while the row's link has keyboard
 * focus, and on any focus in the last opened row: browsers do not show
 * `:focus-visible` when focus comes back to it after a mouse click. It grows in
 * and out like an input's ring, with the same transition.
 *
 * The selectors name the ring itself instead of using Tailwind's
 * `group-has-*`, which styles `*` under a `:has()`: Chrome then restyles the
 * whole page each time an element is added anywhere in it.
 */
export function RowFocusRing() {
  return (
    <span
      aria-hidden
      className="ring-primary pointer-events-none absolute inset-0.5 rounded-md ring-0 transition-[box-shadow] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] [.focus-ring-row:has(a:focus-visible)_&]:ring-2 [.focus-ring-row[data-last-opened]:has(a:focus)_&]:ring-2"
    />
  );
}
