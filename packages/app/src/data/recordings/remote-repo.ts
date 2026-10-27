import type { GetRecordingInput, ListRecordingsInput, RecordingsRepositoryLike } from "./schemas";
import { getRecording, listRecordings } from "./server";

export const remoteRecordingsRepo: RecordingsRepositoryLike = {
  list: (input: ListRecordingsInput) => listRecordings({ data: input }),
  get: (input: GetRecordingInput) => getRecording({ data: input }),
};
