import { useState } from "react";

/**
 * The item open now, or the one open last, for the list to mark its row. It
 * takes the open item from the URL, so the mark changes with the detail and not
 * on the click. The item the page loaded on does not count: the list was never
 * on screen with it.
 */
export function useLastOpened(opened: string | undefined) {
  const [listShown, setListShown] = useState(opened === undefined);
  if (opened === undefined && !listShown) setListShown(true);
  const current = listShown ? opened : undefined;
  const [last, setLast] = useState<string>();
  if (current !== undefined && current !== last) setLast(current);
  return current ?? last;
}

/** The last opened row's mark: an inset bar, so the columns stay aligned. */
export const lastOpenedRow =
  "data-last-opened:bg-muted/70 data-last-opened:shadow-[inset_2px_0_0_var(--primary)]";
