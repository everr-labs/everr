import {
  type Attributes,
  context,
  createContextKey,
  type Span,
  trace,
} from "@opentelemetry/api";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";

type IdentityScope = { attributes: Attributes; root?: Span };
const identityKey = createContextKey("everr.telemetry.identity");

function identityScope(ctx = context.active()): IdentityScope | undefined {
  return ctx.getValue(identityKey) as IdentityScope | undefined;
}

/** Open before the request or job root span. Identity stays local, never in baggage. */
export function withTelemetryIdentityScope<T>(run: () => T): T {
  const scope: IdentityScope = { attributes: {} };
  return context.with(context.active().setValue(identityKey, scope), run);
}

/** Omitted fields retain their values; a null organization clears future attribution. */
export function mergeTelemetryIdentity(identity: {
  organizationId?: string | null;
  userId?: string;
}): void {
  const attributes: Attributes = {};
  if (identity.organizationId)
    attributes["everr.organization.id"] = identity.organizationId;
  if (identity.userId) attributes["user.id"] = identity.userId;
  const scope = identityScope();
  if (scope) {
    if (identity.organizationId === null)
      delete scope.attributes["everr.organization.id"];
    Object.assign(scope.attributes, attributes);
    scope.root?.setAttributes(attributes);
  }
  trace.getActiveSpan()?.setAttributes(attributes);
}

export const identitySpanProcessor: SpanProcessor = {
  onStart(span, parentContext): void {
    const scope = identityScope(parentContext);
    if (!scope) return;
    scope.root ??= span;
    span.setAttributes(scope.attributes);
  },
  onEnd(): void {},
  async forceFlush(): Promise<void> {},
  async shutdown(): Promise<void> {},
};

export const identityLogProcessor: LogRecordProcessor = {
  onEmit(record, ctx): void {
    // Explicit event attributes can describe work concerning a different org.
    record.setAttributes({
      ...identityScope(ctx)?.attributes,
      ...record.attributes,
    });
  },
  async forceFlush(): Promise<void> {},
  async shutdown(): Promise<void> {},
};
