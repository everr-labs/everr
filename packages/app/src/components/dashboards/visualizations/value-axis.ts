export const MIN_VALUE_AXIS_WIDTH = 60;
const APPROXIMATE_CHARACTER_WIDTH = 7;
const TICK_PADDING = 16;

export function valueAxisWidth(
  values: number[],
  format: (value: number) => string,
): number {
  return Math.max(
    MIN_VALUE_AXIS_WIDTH,
    ...values.map(
      (value) =>
        format(value).length * APPROXIMATE_CHARACTER_WIDTH + TICK_PADDING,
    ),
  );
}
