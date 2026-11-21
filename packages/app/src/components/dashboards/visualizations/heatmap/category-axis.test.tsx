import type { ChartTheme } from "@everr/ui/hooks/use-echart";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { CategoryAxis } from "./category-axis";

const theme = { fontFamily: "sans-serif" } as ChartTheme;
const plot = { left: 40, top: 0, width: 200, height: 100 };

function shownLabels(labels: string[]) {
  const { container } = render(<CategoryAxis theme={theme} labels={labels} plot={plot} />);
  return [...container.querySelectorAll("span")].map((span) => ({
    text: span.textContent,
    left: Number.parseFloat(span.style.left),
    transform: span.style.transform,
  }));
}

describe("CategoryAxis", () => {
  it("labels every column when they fit", () => {
    expect(shownLabels(["a", "b", "c", "d"]).map((label) => label.text)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("shows every nth label when they don't all fit", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => String(hour));
    const shown = shownLabels(hours).map((label) => label.text);
    expect(shown.length).toBeLessThan(hours.length);
    const every = hours.indexOf(shown[1] ?? "");
    expect(shown).toEqual(hours.filter((_, index) => index % every === 0));
  });

  it("ends a long last label at the plot's right edge instead of centering it", () => {
    // Thinned to every other column, the last label is wider than its column.
    const shown = shownLabels(["us-east-1", "eu-west-1", "ca-central-1"]);
    expect(shown.map((label) => label.text)).toEqual(["us-east-1", "ca-central-1"]);
    expect(shown.at(-1)).toMatchObject({
      left: plot.left + plot.width,
      transform: "translateX(-100%)",
    });
  });
});
