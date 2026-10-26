/** Feature-owned facts. Producers pass stable IDs and facts, never database rows. */
export interface EventInput {
  readonly type: string;
  readonly version: number;
  readonly subjectId: string;
  readonly actorId?: string;
  readonly data: unknown;
}

export type PublishedEvent<F extends EventInput = EventInput> = F & {
  readonly id: string;
  readonly occurredAt: string;
};

/**
 * Call only after the source commit succeeds. Publication never changes its result.
 * Features accept EventPublisher<FeatureEvent>; application routing handles the broad fact type.
 */
export interface EventPublisher<F extends EventInput = EventInput> {
  publish(this: void, fact: F): void;
}

/**
 * Features own their schema, including literal type/version and payload validation.
 * Parse fact-shaped input without mutating it and return independently owned payloads,
 * as Zod object schemas do. The publisher freezes the envelope, not nested payloads.
 */
export interface EventDefinition<F extends EventInput = EventInput> {
  readonly type: F["type"];
  readonly version: F["version"];
  parse(this: void, input: unknown): F;
}

/** Static, application-owned consumer. Registration does not start a worker. */
export interface EventSubscriber<F extends EventInput = EventInput> {
  readonly id: string;
  enqueue(this: void, event: PublishedEvent<F>): void | Promise<void>;
}

/** One feature definition and its typed consumers, including known facts with no consumers. */
export interface EventRegistration<F extends EventInput = EventInput> {
  readonly definition: EventDefinition<F>;
  readonly subscribers: readonly EventSubscriber<F>[];
}

export type ApplicationEvents = readonly EventRegistration[];
