import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { createContext, type ReactNode, useCallback, useContext } from "react";

const DetailRouteDialogCloseContext = createContext<(() => void) | null>(null);

/**
 * Inside a {@link DetailRouteDialog} this returns a function that closes the
 * detail route. Returns `null` when the detail is not rendered inside the modal
 * (e.g. opened as a full page via a direct URL), so callers can fall back to
 * navigating directly.
 */
export function useDetailRouteDialogClose() {
  return useContext(DetailRouteDialogCloseContext);
}

export function DetailRouteDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => Promise<unknown> | undefined;
}) {
  const close = useCallback(() => {
    void onClose();
  }, [onClose]);

  return (
    <Dialog
      open={true}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-2 right-2 bottom-2 left-2 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-lg p-0 sm:max-w-none"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <DetailRouteDialogCloseContext.Provider value={close}>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[var(--titlebar-top)]">
            {children}
          </div>
        </DetailRouteDialogCloseContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
