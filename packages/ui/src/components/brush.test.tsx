import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { expect, it, vi } from "vite-plus/test";
import { useBrush } from "./brush";

const press = (clientX: number) =>
  ({
    pointerType: "mouse",
    button: 0,
    clientX,
    pointerId: 1,
    currentTarget: { setPointerCapture: () => {} },
  }) as unknown as PointerEvent;

it("selects only a range at least minSpan wide", () => {
  const onSelect = vi.fn();
  const { result } = renderHook(() =>
    useBrush({ positionAt: (event) => event.clientX * 100, minSpan: 1000, onSelect }),
  );
  const drag = (from: number, to: number) => {
    act(() => result.current.handlers.onPointerDown(press(from)));
    act(() => result.current.handlers.onPointerMove(press(to)));
    act(() => result.current.handlers.onPointerUp());
  };

  drag(10, 15);
  expect(onSelect).not.toHaveBeenCalled();

  drag(30, 10);
  expect(onSelect).toHaveBeenCalledWith(1000, 3000);
});
