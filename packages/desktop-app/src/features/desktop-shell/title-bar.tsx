import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

/**
 * DOM nodes for the app shell's single top title bar. The shell owns the bar
 * (so it spans the whole window top and the nav can sit below it at a fixed
 * position); pages portal their title + controls into these slots via
 * {@link PageTitleBar} instead of rendering their own header rows.
 */
interface TitleBarSlots {
  left: HTMLElement | null;
  right: HTMLElement | null;
}

export const TitleBarSlotsContext = createContext<TitleBarSlots>({
  left: null,
  right: null,
});

export function PageTitleBar({ title, actions }: { title?: ReactNode; actions?: ReactNode }) {
  const { left, right } = useContext(TitleBarSlotsContext);
  return (
    <>
      {left && title
        ? createPortal(
            <span className="truncate text-sm font-medium text-[var(--settings-text)]">
              {title}
            </span>,
            left,
          )
        : null}
      {right && actions ? createPortal(actions, right) : null}
    </>
  );
}
