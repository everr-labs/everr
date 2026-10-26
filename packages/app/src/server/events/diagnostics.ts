export type PublicationFailureStage =
  | "publication"
  | "validation"
  | "envelope"
  | "subscriber"
  | "overload"
  | "closed"
  | "drain";
export interface PublicationFailure {
  /** Always a registered type, or the bounded sentinel "unknown". */
  eventType: string;
  eventId?: string;
  subjectId?: string;
  subscriberId: string;
  stage: PublicationFailureStage;
  error: unknown;
}
export type PublicationDiagnostics = (failure: PublicationFailure) => void | Promise<void>;

/** An injected reporter cannot change the source result or create an unhandled rejection. */
export function reportPublicationFailure(
  diagnostics: PublicationDiagnostics,
  failure: PublicationFailure,
): void {
  try {
    void Promise.resolve(diagnostics(failure)).catch(() => {});
  } catch {
    // Diagnostics are best effort too.
  }
}
