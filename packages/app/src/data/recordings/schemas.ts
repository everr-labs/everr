import { z } from "zod";

/** Clips fetched per infinite-scroll page. */
export const PAGE_SIZE = 50;

/** A Clip is a short buffer plus a short tail. This caps a runaway read. */
export const MAX_SEGMENTS = 200;

const nameList = z.array(z.string()).default([]);

export const ListRecordingsInputSchema = z.object({
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  service: nameList,
  environment: nameList,
  limit: z.coerce.number().int().positive().max(200).default(PAGE_SIZE),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListRecordingsInput = z.infer<typeof ListRecordingsInputSchema>;

export const GetRecordingInputSchema = z.object({
  clipId: z.string().trim().min(1).max(80),
  fromTs: z.string().min(1),
  toTs: z.string().min(1),
  service: nameList,
  environment: nameList,
});
export type GetRecordingInput = z.infer<typeof GetRecordingInputSchema>;

export type RecordingClipSummary = {
  clipId: string;
  streamId: string;
  sessionId: string;
  serviceName: string;
  /** ClickHouse DateTime text of the earliest Segment in the page window. */
  startedAt: string;
  /** ClickHouse DateTime text of the latest Segment in the page window. */
  endedAt: string;
  url: string;
  route: string;
  /** `error`, `network`, or `manual` from the recording Span. Empty when that Span is missing. */
  trigger: string;
  segmentCount: number;
};

export type RecordingSegment = {
  index: number;
  body: string;
};

export type RecordingClipDetail = RecordingClipSummary & {
  segments: RecordingSegment[];
};

export type RecordingsRepositoryLike = {
  list(input: ListRecordingsInput): Promise<RecordingClipSummary[]>;
  get(input: GetRecordingInput): Promise<RecordingClipDetail | null>;
};
