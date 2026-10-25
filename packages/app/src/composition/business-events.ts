/** Feature-owned facts. Producers pass stable IDs and facts, never database rows. */
export interface BusinessEventFact {
  readonly type: string;
  readonly version: number;
  readonly subjectId: string;
  readonly actorId?: string;
  readonly data: unknown;
}

export type BusinessEvent<F extends BusinessEventFact = BusinessEventFact> = F & {
  readonly id: string;
  readonly occurredAt: string;
};

/**
 * Call only after the source commit succeeds. Publication never changes its result.
 * Features accept BusinessEvents<FeatureFact>; application routing handles the broad fact type.
 */
export interface BusinessEvents<F extends BusinessEventFact = BusinessEventFact> {
  publish(this: void, fact: F): void;
}

/**
 * Features own their schema, including literal type/version and payload validation.
 * Parse fact-shaped input without mutating it and return independently owned payloads,
 * as Zod object schemas do. The publisher freezes the envelope, not nested payloads.
 */
export interface BusinessEventDefinition<F extends BusinessEventFact = BusinessEventFact> {
  readonly type: F["type"];
  readonly version: F["version"];
  parse(this: void, input: unknown): F;
}

/** Static, application-owned consumer. Registration does not start a worker. */
export interface BusinessEventSubscriber<F extends BusinessEventFact = BusinessEventFact> {
  readonly id: string;
  enqueue(this: void, event: BusinessEvent<F>): void | Promise<void>;
}

/** One feature definition and its typed consumers, including known facts with no consumers. */
export interface BusinessEventRegistration<F extends BusinessEventFact = BusinessEventFact> {
  readonly definition: BusinessEventDefinition<F>;
  readonly subscribers: readonly BusinessEventSubscriber<F>[];
}

export type ApplicationBusinessEvents = readonly BusinessEventRegistration[];
