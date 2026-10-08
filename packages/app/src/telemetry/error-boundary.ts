import { context, createContextKey } from "@opentelemetry/api";

const boundaryCapture = createContextKey("everr.telemetry.error-boundary");

export function withBoundaryErrorCapture<T>(run: () => T): T {
  return context.with(context.active().setValue(boundaryCapture, true), run);
}

export function hasBoundaryErrorCapture(): boolean {
  return context.active().getValue(boundaryCapture) === true;
}
