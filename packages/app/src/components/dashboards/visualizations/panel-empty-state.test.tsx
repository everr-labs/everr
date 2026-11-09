import { render, screen } from "@testing-library/react";
import { Hash } from "lucide-react";
import { expect, it } from "vite-plus/test";
import { PanelEmptyState } from "./panel-empty-state";

it.each([
  ["no query", undefined, "No query"],
  ["a query with no rows", [[], []], "No data"],
  ["rows the panel cannot use", [[{ name: "a" }]], "Nothing to draw"],
])("explains %s", (_, data, title) => {
  render(<PanelEmptyState icon={Hash} data={data} unusable="Needs a number." />);
  expect(screen.getByText(title)).toBeInTheDocument();
});

it("says what the panel needed from rows it cannot use", () => {
  render(<PanelEmptyState icon={Hash} data={[[{ name: "a" }]]} unusable="Needs a number." />);
  expect(screen.getByText("Needs a number.")).toBeInTheDocument();
});
