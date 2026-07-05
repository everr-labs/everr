import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { DetailRouteDialog, useDetailRouteDialogClose } from "./detail-route-dialog";

vi.mock("@everr/ui/components/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <section data-open={String(open)} data-testid="dialog-root">
      <button type="button" onClick={() => onOpenChange(false)}>
        Primitive close
      </button>
      {children}
    </section>
  ),
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function ContextCloseButton() {
  const close = useDetailRouteDialogClose();

  return (
    <button type="button" onClick={() => close?.()}>
      Context close
    </button>
  );
}

describe("DetailRouteDialog", () => {
  it("keeps the dialog open while mounted after requesting a route close", async () => {
    const closeDeferred = createDeferred();
    const onClose = vi.fn(() => closeDeferred.promise);

    render(
      <DetailRouteDialog title="Detail" onClose={onClose}>
        <ContextCloseButton />
      </DetailRouteDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Context close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("dialog-root")).toHaveAttribute("data-open", "true");

    await act(async () => {
      closeDeferred.resolve();
      await closeDeferred.promise;
      await Promise.resolve();
    });

    expect(screen.getByTestId("dialog-root")).toHaveAttribute("data-open", "true");
  });
});
