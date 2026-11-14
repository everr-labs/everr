import { render, screen } from "@testing-library/react";
import { Hash } from "lucide-react";
import { expect, it } from "vite-plus/test";
import { PanelEmptyState } from "./panel-empty-state";

it.each([
  ["no query", undefined, "No query", null],
  ["a query with no rows", [[], []], "No data", null],
  ["rows the panel cannot use", [[{ name: "a" }]], "Nothing to draw", "Needs a number."],
])("explains %s", (_, data, title, detail) => {
  render(<PanelEmptyState icon={Hash} data={data} unusable="Needs a number." />);
  expect(screen.getByText(title)).toBeInTheDocument();
  expect(screen.queryByText("Needs a number.")?.textContent ?? null).toBe(detail);
});
