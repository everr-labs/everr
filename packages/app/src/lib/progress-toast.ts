import { type ExternalToast, toast } from "sonner";

/** Most requests finish sooner; for those, only the result toast appears. */
const SHOW_LOADING_AFTER_MS = 150;
/** Once the loading toast is up, it stays this long, so it never flickers. */
const MIN_LOADING_VISIBLE_MS = 400;

/**
 * One toast for an action that has no busy state of its own (a row action, a
 * menu item): it shows a spinner while the request runs, then turns into the
 * result in place instead of a second toast appearing beside it.
 */
export function progressToast(message: string) {
  let id: string | number | undefined;
  let shownAt = 0;
  const showTimer = setTimeout(() => {
    id = toast.loading(message);
    shownAt = Date.now();
  }, SHOW_LOADING_AFTER_MS);

  const settle = (show: (id: string | number | undefined) => void) => {
    clearTimeout(showTimer);
    if (id === undefined) {
      show(undefined);
      return;
    }
    const loadingId = id;
    setTimeout(() => show(loadingId), Math.max(0, MIN_LOADING_VISIBLE_MS - (Date.now() - shownAt)));
  };

  return {
    success: (result: string, options?: ExternalToast) =>
      settle((toastId) => toast.success(result, { ...options, id: toastId })),
    error: (result: string) => settle((toastId) => toast.error(result, { id: toastId })),
  };
}
