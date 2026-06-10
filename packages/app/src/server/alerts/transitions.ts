export type AlertState = "unknown" | "resolved" | "firing";
export type Transition = "fire" | "still_firing" | "resolve" | "still_resolved";

export function computeTransition(
  previous: AlertState,
  rowCount: number,
): Transition {
  if (rowCount > 0) {
    return previous === "firing" ? "still_firing" : "fire";
  }
  return previous === "firing" ? "resolve" : "still_resolved";
}
