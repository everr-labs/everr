import { useEffect, useRef, useState } from "react";

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

/**
 * A ref for the list under a detail. When the detail closes, it gives focus
 * back to the row the reader opened, as a dialog gives it back to its opener.
 * Without it, focus falls to the page and a keyboard reader starts over.
 */
export function useFocusLastOpened<T extends HTMLElement = HTMLElement>(detailOpen: boolean) {
  const listRef = useRef<T>(null);
  useEffect(() => {
    if (detailOpen) return;
    listRef.current
      ?.querySelector<HTMLElement>("[data-last-opened] a")
      ?.focus({ preventScroll: true });
  }, [detailOpen]);
  return listRef;
}
