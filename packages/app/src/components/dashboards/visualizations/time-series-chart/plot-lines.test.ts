import { describe, expect, it } from "vite-plus/test";
import { plotLines } from "./plot-lines";
import { buildChartModel, type ChartSeries } from "./time-series-data";

type SeriesPoint = [time: number, value: number | null];

/** Every point of a model line as `[time, value]`, null where there is no number. */
function allPoints(series: ChartSeries | undefined): SeriesPoint[] {
  return Array.from(series?.times ?? [], (time, i) => {
    const value = series?.values[i] ?? Number.NaN;
    return [time, Number.isNaN(value) ? null : value];
  });
}

const FROM = Date.parse("2026-06-07T00:00:00Z");
const SECOND = 1_000;

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

/** One row a second from FROM, wandering, in the shape a query returns. */
function wanderingRows(count: number, seed: number, column = "value") {
  const random = seeded(seed);
  let value = 50;
  return Array.from({ length: count }, (_, i) => {
    value += random() - 0.5;
    return { ts: FROM + i * SECOND, [column]: value };
  });
}

interface ColumnEnvelope {
  first: number;
  last: number;
  low: number;
  high: number;
  points: number;
}

/** What a line shows in each pixel column: where it enters and leaves, and
 * how low and high it goes. Worked out the slow way, as the reference. */
function envelopes(
  points: readonly SeriesPoint[],
  [from, to]: readonly [number, number],
  columns: number,
): Map<number, ColumnEnvelope> {
  const byColumn = new Map<number, ColumnEnvelope>();
  for (const [time, value] of points) {
    if (value === null) continue;
    const column = Math.floor(((time - from) * columns) / (to - from));
    const seen = byColumn.get(column);
    if (!seen) {
      byColumn.set(column, { first: time, last: time, low: value, high: value, points: 1 });
      continue;
    }
    seen.last = time;
    seen.low = Math.min(seen.low, value);
    seen.high = Math.max(seen.high, value);
    seen.points++;
  }
  return byColumn;
}

/** The envelopes of `points`, without how many points each column holds. */
function shapes(
  points: readonly SeriesPoint[],
  domain: readonly [number, number],
  columns: number,
) {
  return new Map(
    [...envelopes(points, domain, columns)].map(([column, { first, last, low, high }]) => [
      column,
      { first, last, low, high },
    ]),
  );
}

describe("plotLines", () => {
  it("hands back a line with few points per pixel as it is", () => {
    const model = buildChartModel([wanderingRows(300, 1)], [FROM, FROM + 300 * SECOND]);
    const [line] = plotLines(model, false).forPlot(100, 1);
    expect(line?.points).toEqual(allPoints(model.series[0]));
  });

  it("keeps where a dense line enters, leaves, bottoms and peaks in every pixel column", () => {
    const domain: [number, number] = [FROM, FROM + 20_000 * SECOND];
    const model = buildChartModel([wanderingRows(20_000, 2)], domain);
    const full = allPoints(model.series[0]);

    const [line] = plotLines(model, false).forPlot(250, 1);
    const drawn = line?.points ?? [];

    expect(shapes(drawn, domain, 250)).toEqual(shapes(full, domain, 250));
    expect(drawn.length).toBeLessThanOrEqual(4 * 250);
    for (const column of envelopes(drawn, domain, 250).values()) {
      expect(column.points).toBeLessThanOrEqual(4);
    }
    // The model's own points, in the model's order: none moved or made up.
    const positions = drawn.map(([time, value]) =>
      full.findIndex((point) => point[0] === time && point[1] === value),
    );
    expect(positions.every((position, i) => position > (positions[i - 1] ?? -1))).toBe(true);
  });

  it("keeps a spike one sample wide at its full height", () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      ts: FROM + i * SECOND,
      value: i === 4_321 ? 999 : 1,
    }));
    // The range ends on the last sample, which must stay too.
    const model = buildChartModel([rows], [FROM, FROM + 9_999 * SECOND]);
    const [line] = plotLines(model, false).forPlot(100, 1);
    expect(line?.points.length).toBeLessThan(500);
    expect(line?.points).toContainEqual([FROM + 4_321 * SECOND, 999]);
    expect(line?.points.at(-1)).toEqual([FROM + 9_999 * SECOND, 1]);
  });

  it("thins to the canvas's own pixels, twice as fine on a screen twice as sharp", () => {
    const domain: [number, number] = [FROM, FROM + 20_000 * SECOND];
    const model = buildChartModel([wanderingRows(20_000, 11)], domain);
    const full = allPoints(model.series[0]);
    const [line] = plotLines(model, false).forPlot(125, 2);
    expect(shapes(line?.points ?? [], domain, 250)).toEqual(shapes(full, domain, 250));
    expect(line?.points.length).toBeLessThanOrEqual(4 * 250);
  });

  it("thins to the width asked for, so a wider plot shows more", () => {
    const model = buildChartModel([wanderingRows(20_000, 3)], [FROM, FROM + 20_000 * SECOND]);
    const lines = plotLines(model, false);
    const narrow = lines.forPlot(100, 1)[0]?.points.length ?? 0;
    const wide = lines.forPlot(400, 1)[0]?.points.length ?? 0;
    expect(narrow).toBeLessThanOrEqual(400);
    expect(wide).toBeGreaterThan(narrow);
    expect(lines.forPlot(100, 1)).toEqual(lines.forPlot(100, 1));
  });

  it("keeps a gap in a dense line, and the points on each side of it", () => {
    // An outage from 00:50:00 to 01:40:00.
    const rows = wanderingRows(10_000, 4).filter((_, i) => i < 3_000 || i >= 6_000);
    const domain: [number, number] = [FROM, FROM + 10_000 * SECOND];
    const model = buildChartModel([rows], domain);
    const full = allPoints(model.series[0]);
    const gap = full.findIndex(([, value]) => value === null);
    expect(gap).toBeGreaterThan(0);

    // Two pixel columns: the whole outage and both its edges share one.
    const [line] = plotLines(model, false).forPlot(2, 1);
    const drawn = line?.points ?? [];
    const drawnGap = drawn.findIndex(([, value]) => value === null);

    expect(drawn.filter(([, value]) => value === null)).toHaveLength(1);
    expect(drawn[drawnGap - 1]).toEqual(full[gap - 1]);
    expect(drawn[drawnGap]).toEqual(full[gap]);
    expect(drawn[drawnGap + 1]).toEqual(full[gap + 1]);
  });

  it("keeps the bucket that starts left of the time range", () => {
    const domain: [number, number] = [FROM + 500, FROM + 5_000 * SECOND];
    const model = buildChartModel([wanderingRows(5_000, 5)], domain);
    const full = allPoints(model.series[0]);
    expect(full[0]?.[0]).toBeLessThan(domain[0]);

    const [line] = plotLines(model, false).forPlot(50, 1);
    expect(line?.points.length).toBeLessThan(full.length);
    expect(line?.points[0]).toEqual(full[0]);
  });

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    "draws every point while the plot is %s wide",
    (plotWidth) => {
      const model = buildChartModel([wanderingRows(5_000, 6)], [FROM, FROM + 5_000 * SECOND]);
      const [line] = plotLines(model, false).forPlot(plotWidth, 1);
      expect(line?.points).toEqual(allPoints(model.series[0]));
    },
  );

  it("covers the same values whatever the width", () => {
    const rows = wanderingRows(8_000, 7);
    const values = rows.map((row) => Number(row.value));
    const model = buildChartModel([rows], [FROM, FROM + 8_000 * SECOND]);
    const lines = plotLines(model, false);

    expect(lines.extent).toEqual([Math.min(...values), Math.max(...values)]);
    for (const width of [10, 137, 800]) {
      const drawn = lines.forPlot(width, 1)[0]?.points.flatMap(([, value]) => value ?? []) ?? [];
      expect([Math.min(...drawn), Math.max(...drawn)]).toEqual(lines.extent);
    }
  });

  it("has no extent when there is nothing to draw", () => {
    const lines = plotLines(buildChartModel([], [FROM, FROM + SECOND]), false);
    expect(lines.extent).toEqual([Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]);
    expect(lines.forPlot(800, 1)).toEqual([]);
  });

  it("draws one line per series, in the model's order", () => {
    const rows = wanderingRows(100, 8).map((row, i) => ({ ...row, other: i }));
    const model = buildChartModel([rows], [FROM, FROM + 100 * SECOND]);
    expect(plotLines(model, false).forPlot(800, 1)).toEqual(
      model.series.map((series) => ({
        id: series.id,
        color: series.color,
        points: allPoints(series),
      })),
    );
  });
});

describe("plotLines, stacked", () => {
  it("puts every series on the shared timeline and fills what is missing with zero", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", a: 1, b: 10 },
          { time: "2026-06-07T00:01:00", a: 2, b: "oops" }, // non-numeric → null sample
        ],
        [{ time: "2026-06-07T00:00:00", c: 100 }], // absent at 00:01
      ],
      [FROM, FROM + 120 * SECOND],
    );
    const lines = plotLines(model, true).forPlot(800, 1);
    expect(lines.map(({ points }) => points)).toEqual([
      [
        [FROM, 1],
        [FROM + 60 * SECOND, 2],
      ],
      [
        [FROM, 10],
        [FROM + 60 * SECOND, 0],
      ],
      [
        [FROM, 100],
        [FROM + 60 * SECOND, 0],
      ],
    ]);
    expect(lines.map(({ id }) => id)).toEqual(model.series.map(({ id }) => id));
  });

  it("covers zero and every band edge, above and below it", () => {
    const model = buildChartModel(
      [
        [
          { time: "2026-06-07T00:00:00", a: 100, b: -50 },
          { time: "2026-06-07T00:01:00", a: -100, b: 50 },
        ],
      ],
      [FROM, FROM + 120 * SECOND],
    );
    expect(plotLines(model, true).extent).toEqual([-100, 100]);
  });

  it("thins every band to the same timestamps, and keeps each edge's shape", () => {
    const count = 6_000;
    const domain: [number, number] = [FROM, FROM + count * SECOND];
    // The second query misses a stretch, so its series is absent there.
    const model = buildChartModel(
      [
        wanderingRows(count, 9, "a").map((row, i) => ({ ...row, b: 20 + (i % 97) })),
        wanderingRows(count, 10, "c").filter((_, i) => i < 2_000 || i >= 2_500),
      ],
      domain,
    );
    const lines = plotLines(model, true);
    const full = lines.forPlot(100_000, 1).map(({ points }) => points);
    const drawn = lines.forPlot(50, 1).map(({ points }) => points);

    expect(full[0]).toHaveLength(count);
    expect(drawn[0]?.length).toBeLessThan(count / 4);
    const times = drawn[0]?.map(([time]) => time);
    for (const points of drawn) expect(points.map(([time]) => time)).toEqual(times);

    // Each band keeps its own values, and ECharts sums them: every edge it
    // draws must keep the shape of the full one.
    const edges = (bands: SeriesPoint[][]) => {
      const tops = new Map<number, number>();
      return bands.map((points) =>
        points.map(([time, value]): SeriesPoint => {
          const top = (tops.get(time) ?? 0) + (value ?? 0);
          tops.set(time, top);
          return [time, top];
        }),
      );
    };
    const fullEdges = edges(full);
    edges(drawn).forEach((edge, band) => {
      expect(shapes(edge, domain, 50)).toEqual(shapes(fullEdges[band] ?? [], domain, 50));
    });
  });
});
