export type SpanStatus = "Ok" | "Error" | "Unset";

export type TraceSummary = {
  traceId: string;
  rootName: string;
  rootService: string;
  rootNamespace: string;
  rootStatus: SpanStatus;
  /**
   * The HTTP response status code of the root span. It is "" when the root span
   * is not an HTTP span.
   *
   * The value comes from the OpenTelemetry `http.response.status_code`
   * attribute. When that attribute is absent, it comes from `http.status_code`,
   * the name before version 1.23 that some SDKs still send.
   */
  rootStatusCode: string;
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
