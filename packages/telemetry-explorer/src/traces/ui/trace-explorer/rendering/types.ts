export type FlamegraphEvent = {
  name: string;
  /** Nanoseconds relative to the trace start, rather than a Unix timestamp. */
  offsetNs: number;
  attributeMap: Record<string, string>;
  isError: boolean;
};

export type FlamegraphSpan = {
  spanId: string;
  parentSpanId: string;
  name: string;
  /** Milliseconds relative to the trace start. */
  timestamp: number;
  durationNano: number;
  hasError: boolean;
  resource: Record<string, string>;
  attributes: Record<string, string>;
  event: FlamegraphEvent[];
};

export type WaterfallSpan = {
  spanId: string;
  parentSpanId: string;
  level: number;
  hasChildren: boolean;
};

export type ColorByField = { name: string };

export type SpanRect = {
  span: FlamegraphSpan;
  x: number;
  y: number;
  width: number;
  height: number;
  level: number;
  color?: string;
};

export type EventRect = {
  event: FlamegraphEvent;
  span: FlamegraphSpan;
  cx: number;
  cy: number;
  halfSize: number;
};

export function getSpanAttribute(
  span: Partial<Pick<FlamegraphSpan, "resource" | "attributes">>,
  key: string,
): string | undefined {
  return span.attributes?.[key] ?? span.resource?.[key];
}
