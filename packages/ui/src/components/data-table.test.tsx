import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { DataTable } from "./data-table";

type Row = { id: string };
const columns = [{ header: "Id", cell: (row: Row) => row.id }];

function table(data: Row[]) {
  return <DataTable data={data} columns={columns} rowKey={(row) => row.id} animateRows />;
}

// jsdom has no AnimationEvent, so fireEvent would drop `animationName`, and
// React there listens for the prefixed `webkitAnimationEnd`.
function animationEnd(target: Element, animationName: string) {
  const event = new Event("webkitAnimationEnd", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: animationName });
  fireEvent(target, event);
}

it("removes a deleted row once its exit animation ends", () => {
  const { rerender } = render(table([{ id: "a" }, { id: "b" }]));
  rerender(table([{ id: "a" }]));

  const leaving = screen.getByText("b").closest("tr");
  if (!leaving) throw new Error("row b is not rendered");
  // The cells' own collapse ends too and bubbles up; the row stays for it.
  animationEnd(leaving, "cell-shrink");
  expect(screen.getByText("b")).toBeInTheDocument();

  // The name of the `row-exit` keyframe in global.css.
  animationEnd(leaving, "row-exit");
  expect(screen.queryByText("b")).toBeNull();
});
