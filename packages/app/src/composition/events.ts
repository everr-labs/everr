import type { TaskSpec } from "graphile-worker";

/** Feature-owned facts. Publish only after the source commit succeeds. */
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

/** Resolves after Graphile admission is attempted. Enqueue failures are logged, not thrown. */
export interface EventPublisher<F extends EventInput = EventInput> {
  publish(this: void, fact: F): Promise<void>;
}

/** Features own their literal event type, version and payload schema. */
export interface EventDefinition<F extends EventInput = EventInput> {
  readonly type: F["type"];
  readonly version: F["version"];
  parse(this: void, input: unknown): F;
}

export interface EventJob {
  readonly task: string;
  readonly payload: unknown;
  readonly spec?: TaskSpec;
}

/** Application wiring maps a validated event directly to a Graphile job. */
export interface EventRoute<F extends EventInput = EventInput> {
  readonly definition: EventDefinition<F>;
  job(this: void, event: PublishedEvent<F>): EventJob;
}

export type ApplicationEvents = readonly EventRoute[];
