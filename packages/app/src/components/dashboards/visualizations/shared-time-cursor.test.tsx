import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { SharedTimeCursorProvider, usePointTimeCursor, useTimeCursor } from "./shared-time-cursor";

function Cursor() {
  return <output>{useTimeCursor() ?? "none"}</output>;
}

function Panel({ name, at }: { name: string; at: number }) {
  const { set, clear } = usePointTimeCursor();
  return (
    <>
      <button type="button" onClick={() => set(at)}>
        enter {name}
      </button>
      <button type="button" onClick={clear}>
        leave {name}
      </button>
    </>
  );
}

function Dashboard({ showB = true }: { showB?: boolean }) {
  return (
    <SharedTimeCursorProvider>
      <Panel name="A" at={100} />
      {showB && <Panel name="B" at={200} />}
      <Cursor />
    </SharedTimeCursorProvider>
  );
}

it("keeps the cursor of the panel entered last when the previous one reports leaving", () => {
  render(<Dashboard />);
  fireEvent.click(screen.getByText("enter A"));
  fireEvent.click(screen.getByText("enter B"));
  fireEvent.click(screen.getByText("leave A"));
  expect(screen.getByRole("status")).toHaveTextContent("200");

  fireEvent.click(screen.getByText("leave B"));
  expect(screen.getByRole("status")).toHaveTextContent("none");
});

it("clears the cursor when the panel pointing it unmounts", () => {
  const { rerender } = render(<Dashboard />);
  fireEvent.click(screen.getByText("enter B"));
  rerender(<Dashboard showB={false} />);
  expect(screen.getByRole("status")).toHaveTextContent("none");
});
