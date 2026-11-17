import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { DataTable } from "./data-table";

type Row = { id: string };
const columns = [{ header: "Id", cell: (row: Row) => row.id }];

function table(data: Row[], animateRows = true) {
  return (
    <DataTable data={data} columns={columns} rowKey={(row) => row.id} animateRows={animateRows} />
  );
}

// jsdom has no AnimationEvent, so fireEvent would drop `animationName`, and
// React there listens for the prefixed `webkitAnimationEnd`. Send both names
// so the test keeps working if jsdom gains AnimationEvent.
function animationEnd(target: Element, animationName: string) {
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, "animationName", { value: animationName });
    fireEvent(target, event);
  }
}

it("removes a deleted row once its exit animation ends", () => {
  const { rerender } = render(table([{ id: "a" }, { id: "b" }]));
  rerender(table([{ id: "a" }]));

  const leaving = screen.getByText("b").closest("tr");
  if (!leaving) throw new Error("row b is not rendered");
  // The cells' height collapse ends too and bubbles up; the row stays for it.
  animationEnd(leaving, "cell-shrink");
  expect(screen.getByText("b")).toBeInTheDocument();

  // The cells' fade-out, the `row-exit` keyframe in global.css.
  animationEnd(leaving, "row-exit");
  expect(screen.queryByText("b")).toBeNull();
});

it("doesn't bring back rows removed while animations were off", () => {
  const { rerender } = render(table([{ id: "a" }]));
  rerender(table([{ id: "b" }], false));
  rerender(table([{ id: "b" }]));

  expect(screen.queryByText("a")).toBeNull();
  expect(screen.getByText("b").closest("tr")).not.toHaveAttribute("data-row-phase");
});
