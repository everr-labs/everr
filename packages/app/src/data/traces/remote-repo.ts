import type {
  AttributeKey,
  GetTraceInput,
  ListServiceIdentitiesInput,
  SearchTracesInput,
  TraceAttributeKeysInput,
  TraceAttributeValuesInput,
  TracesRepositoryLike,
} from "@everr/telemetry-explorer/traces";
import {
  getTrace,
  getTraceAttributeKeys,
  getTraceAttributeValues,
  listServiceIdentities,
  searchTraces,
} from "./server";

export const remoteTracesRepo: TracesRepositoryLike = {
  search: (input: SearchTracesInput) => searchTraces({ data: input }),
  getTrace: (input: GetTraceInput) => getTrace({ data: input }),
  listServiceIdentities: (input: ListServiceIdentitiesInput) =>
    listServiceIdentities({ data: input }),
  attributeKeys: (input: TraceAttributeKeysInput): Promise<AttributeKey[]> =>
    getTraceAttributeKeys({ data: input }),
  attributeValues: (input: TraceAttributeValuesInput): Promise<string[]> =>
    getTraceAttributeValues({ data: input }),
};
