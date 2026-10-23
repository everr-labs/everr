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
export interface BusinessEventSubscriber {
  readonly id: string;
  readonly definition: BusinessEventDefinition;
  enqueue(this: void, event: BusinessEvent): void | Promise<void>;
}

export interface ApplicationBusinessEvents {
  readonly definitions: readonly BusinessEventDefinition[];
  readonly subscribers: readonly BusinessEventSubscriber[];
}
