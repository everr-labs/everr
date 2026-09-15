import {
  type Attributes,
  type Context,
  context,
  createContextKey,
  type Span,
  trace,
} from "@opentelemetry/api";
import type { LogRecordProcessor, SdkLogRecord } from "@opentelemetry/sdk-logs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace-node";

export type TelemetryIdentity = {
  organizationId?: string | null;
  userId?: string | null;
};

type IdentityScope = { attributes: Attributes; root?: Span };
const identityKey = createContextKey("everr.telemetry.identity");

/** Local context only: identity is never injected into network baggage. */
export function withTelemetryIdentityScope<T>(
  run: () => T,
  root: Span | null = trace.getActiveSpan() ?? null,
): T {
  const scope: IdentityScope = {
    attributes: {},
    root: root ?? undefined,
  };
  return context.with(context.active().setValue(identityKey, scope), run);
}

/** Call only with an authenticated session or a job's resolved organization. */
export function setTelemetryIdentity(identity: TelemetryIdentity): void {
  const attributes: Attributes = {
    ...(identity.organizationId
      ? { "everr.organization.id": identity.organizationId }
      : {}),
    ...(identity.userId ? { "user.id": identity.userId } : {}),
  };
  const scope = context.active().getValue(identityKey) as
    | IdentityScope
    | undefined;
  if (scope) {
    Object.assign(scope.attributes, attributes);
    scope.root?.setAttributes(attributes);
  }
  trace.getActiveSpan()?.setAttributes(attributes);
}

function identityAttributes(ctx: Context): Attributes {
  return (
    (ctx.getValue(identityKey) as IdentityScope | undefined)?.attributes ?? {}
  );
}

export function createIdentitySpanProcessor(): SpanProcessor {
  return {
    onStart(span: Span, parentContext: Context): void {
      const scope = parentContext.getValue(identityKey) as
        | IdentityScope
        | undefined;
      if (scope) scope.root ??= span;
      span.setAttributes(identityAttributes(parentContext));
    },
    onEnd(): void {},
    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

export function createIdentityLogProcessor(): LogRecordProcessor {
  return {
    onEmit(record: SdkLogRecord, ctx?: Context): void {
      // Explicit event attributes can describe work concerning a different org.
      record.setAttributes({
        ...identityAttributes(ctx ?? context.active()),
        ...record.attributes,
      });
    },
    async forceFlush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}
