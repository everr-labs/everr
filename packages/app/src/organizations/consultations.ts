/** Context established by the successful server-side authorization of a trace read. */
export type ConsultationPrincipal =
  | { kind: "member"; organizationId: string; userId: string; membershipId: string }
  | { kind: "client"; organizationId: string; clientId: string };

export type ConsultedTrace = {
  traceId: string;
  serviceName: string;
  resourceAttributes: unknown;
  spanAttributes: unknown;
};

/** A completed trace detail read, or a supported interactive CLI/MCP trace query.
 * Only trusted server completion code constructs this input, never a request body.
 */
export type TraceConsultation = {
  principal: ConsultationPrincipal;
  surface: "ui" | "cli" | "mcp";
  traces: readonly ConsultedTrace[];
};

/** Application-selected observer. The completed product action never awaits it. */
export interface TraceConsultations {
  observe(this: void, consultation: TraceConsultation): void;
  stop(this: void): Promise<void>;
}
