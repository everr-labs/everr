import type { SqlClient } from "../../sql/client";
import { coveringClipsQuery } from "../sql/coverage";
import { CLIP_TRIGGERS, type ClipSubject, type ClipTrigger, type CoveringClip } from "./schemas";

type CoveringClipRow = {
  clipId: string;
  streamId: string;
  sessionId: string;
  serviceName: string;
  trigger: string;
  truncated: number;
  // Int64: ClickHouse quotes it in JSON, chDB does not.
  startMs: string | number;
  endMs: string | number;
  focusStartMs: string | number;
  focusEndMs: string | number;
};

export class RecordingsRepository {
  private readonly tracesTable: string;

  constructor(
    private readonly client: SqlClient,
    options: { tracesTable?: string } = {},
  ) {
    this.tracesTable = options.tracesTable ?? "traces";
  }

  /** The Clips that cover `subject`, earliest first. Empty for most records. */
  async coveringClips(subject: ClipSubject): Promise<CoveringClip[]> {
    const { sql, params } = coveringClipsQuery(this.tracesTable, subject);
    const rows = await this.client.execute<CoveringClipRow>(sql, params);
    return rows.map(parseCoveringClipRow);
  }
}

function parseCoveringClipRow(row: CoveringClipRow): CoveringClip {
  return {
    clipId: row.clipId,
    streamId: row.streamId,
    sessionId: row.sessionId,
    serviceName: row.serviceName,
    trigger: parseTrigger(row.trigger),
    truncated: row.truncated === 1,
    startMs: Number(row.startMs),
    endMs: Number(row.endMs),
    focus: { startMs: Number(row.focusStartMs), endMs: Number(row.focusEndMs) },
  };
}

function parseTrigger(value: string): ClipTrigger {
  const trigger = CLIP_TRIGGERS.find((known) => known === value);
  if (!trigger) throw new Error(`unknown recording trigger: ${value}`);
  return trigger;
}
