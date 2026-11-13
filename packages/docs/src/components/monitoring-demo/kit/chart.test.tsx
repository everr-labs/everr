import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { Chart } from "./chart";

describe("Chart", () => {
  const markup = renderToStaticMarkup(
    <Chart data={[3, 7.25, 1, 9.125, 4, 6]} width={270} height={200} />,
  );
  const paths = [...markup.matchAll(/ d="([^"]+)"/g)].map((match) => match[1]);

  it("draws a line and its area", () => {
    expect(paths).toHaveLength(2);
  });

  it("writes coordinates to a tenth of a pixel", () => {
    for (const d of paths) {
      for (const number of d.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(number.split(".")[1]?.length ?? 0).toBeLessThanOrEqual(1);
      }
    }
  });

  it("leaves the eased path style to the client", () => {
    expect(markup).not.toContain("path(");
  });
});
