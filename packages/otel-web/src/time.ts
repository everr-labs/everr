/** Converts a browser DOMHighResTimeStamp to integer epoch milliseconds. */
export const epoch = (time: number): number =>
  Math.round(performance.timeOrigin + time);
