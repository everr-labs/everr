import { act, renderHook } from "@testing-library/react";
import type { PointerEvent } from "react";
import { expect, it, vi } from "vite-plus/test";
import { useBrush } from "./brush";

const press = (clientX: number, pointerType = "mouse") =>
  ({
    pointerType,
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

it("reads the chart under a finger unless touch is set to select", () => {
  const onSelect = vi.fn();
  const onTouch = vi.fn();
  const brush = (touchSelects: boolean) =>
    renderHook(() =>
      useBrush({ positionAt: (event) => event.clientX, onSelect, onTouch, touchSelects }),
    ).result;
  const fingerDrag = (result: ReturnType<typeof brush>) => {
    act(() => result.current.handlers.onPointerDown(press(10, "touch")));
    act(() => result.current.handlers.onPointerMove(press(30, "touch")));
    act(() => result.current.handlers.onPointerUp());
  };

  fingerDrag(brush(false));
  expect(onTouch).toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();

  fingerDrag(brush(true));
  expect(onSelect).toHaveBeenCalledWith(10, 30);
});
