import * as z from "zod";

/** A single numeric cell value a generator may emit. */
const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

/** One series of a random walk → one numeric column (wide) or one label (long). */
const seriesSpec = z.looseObject({
  name: z.string(),
  start: z.number().default(0),
  noise: z.number().default(1),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Per-step probability [0,1] the emitted value is null (gaps). */
  nullChance: z.number().min(0).max(1).default(0),
  /** Round emitted values to this many decimals (omit = no rounding). */
  round: z.number().int().optional(),
});

const randomWalkSpec = z.looseObject({
  scenario: z.literal("random_walk"),
  seed: z.number().default(1),
  series: z.array(seriesSpec).min(1),
  /** When set, emit long output: `ts`, `<labelColumn>`, `<valueColumn>`. */
  labelColumn: z.string().optional(),
  valueColumn: z.string().default("value"),
  /** false → omit `ts` and emit `points` rows (row-order sparkline). */
  timeColumn: z.boolean().default(true),
  points: z.number().int().positive().default(50),
});

const walkColumn = z.looseObject({
  start: z.number().default(0),
  noise: z.number().default(1),
  min: z.number().optional(),
  max: z.number().optional(),
  round: z.number().int().optional(),
});

const columnSpec = z.looseObject({
  name: z.string(),
  /** Timestamp spread evenly across [from,to]. */
  time: z.boolean().optional(),
  /** Ascending integer (1-based). */
  seq: z.boolean().optional(),
  /** Cycled categorical values (may include null). */
  values: z.array(cellValue).optional(),
  /** Numeric random-walk column. */
  walk: walkColumn.optional(),
  /** Constant value for every row. */
  const: cellValue.optional(),
});

const tableSpec = z.looseObject({
  scenario: z.literal("table"),
  seed: z.number().default(1),
  rows: z.number().int().min(0).default(10),
  columns: z.array(columnSpec).min(1),
});

const csvSpec = z.looseObject({
  scenario: z.literal("csv"),
  columns: z.array(z.string()).min(1),
  /** Positional rows aligned to `columns`. Empty list → zero-row frame. */
  rows: z.array(z.array(cellValue)),
});

export const testDataSpec = z.discriminatedUnion("scenario", [
  randomWalkSpec,
  tableSpec,
  csvSpec,
]);

export type TestDataSpec = z.infer<typeof testDataSpec>;
export type RandomWalkSpec = z.infer<typeof randomWalkSpec>;
export type TableSpec = z.infer<typeof tableSpec>;
export type CsvSpec = z.infer<typeof csvSpec>;
