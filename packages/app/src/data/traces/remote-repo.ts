import type {
  GetTraceInput,
  ListServiceIdentitiesInput,
  SearchTracesInput,
  TracesRepositoryLike,
} from "@everr/telemetry-explorer/traces";
import { getTrace, listServiceIdentities, searchTraces } from "./server";

export const remoteTracesRepo: TracesRepositoryLike = {
  search: (input: SearchTracesInput) => searchTraces({ data: input }),
  getTrace: (input: GetTraceInput) => getTrace({ data: input }),
  listServiceIdentities: (input: ListServiceIdentitiesInput) =>
    listServiceIdentities({ data: input }),
};
