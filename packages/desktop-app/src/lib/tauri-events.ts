import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { safeGetCurrentWindow } from "./tauri";

export function useInvalidateOnTauriEvent(
  eventName: string,
  invalidate: (queryClient: QueryClient) => void,
) {
  const queryClient = useQueryClient();
  const handleInvalidate = useEffectEvent(() => {
    invalidate(queryClient);
  });

  useEffect(() => {
    const appWindow = safeGetCurrentWindow();
    if (!appWindow) {
      return;
    }

    let unlisten: (() => void) | undefined;

    void appWindow
      .listen(eventName, () => {
        handleInvalidate();
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, [eventName, handleInvalidate]);
}
