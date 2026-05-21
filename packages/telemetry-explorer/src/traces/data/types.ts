export type SpanStatus = "Ok" | "Error" | "Unset";

export type TraceSummary = {
  traceId: string;
  rootName: string;
  rootService: string;
  rootNamespace: string;
  rootStatus: SpanStatus;
  startTs: string;
  durationNs: string;
  spanCount: number;
  errorCount: number;
  services: string[];
};

export type SpanEvent = {
  name: string;
  timestamp: string;
  attributes: Record<string, string>;
};

export type SpanLink = {
  traceId: string;
  spanId: string;
  attributes: Record<string, string>;
};

export type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  spanName: string;
  serviceName: string;
  serviceNamespace: string;
  timestamp: string;
  timestampNs: string;
  duration: string;
  statusCode: SpanStatus;
  spanKind: string;
  spanAttributes: Record<string, string>;
  resourceAttributes: Record<string, string>;
  events: SpanEvent[];
  links: SpanLink[];
};

export type ServiceIdentity = {
  serviceNamespace: string;
  serviceName: string;
};
