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
export interface PublicationDiagnostics {
  log(failure: PublicationFailure): void | Promise<void>;
  count(failure: PublicationFailure): void | Promise<void>;
}

/** A broken logger cannot suppress the counter or create an unhandled rejection. */
export function reportPublicationFailure(
  diagnostics: PublicationDiagnostics,
  failure: PublicationFailure,
): void {
  for (const emit of [() => diagnostics.log(failure), () => diagnostics.count(failure)]) {
    try {
      void Promise.resolve(emit()).catch(() => {});
    } catch {
      // Diagnostics are best effort too.
    }
  }
}
