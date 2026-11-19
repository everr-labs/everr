import { ClipSubjectSchema, RecordingsRepository } from "@everr/telemetry-explorer/recordings";
import { z } from "zod";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import { assertSessionRecordings, clipEvents, replayHttpError } from "./session.ts";

export const getCoveringClips = createAuthenticatedServerFn({ method: "GET" })
  .validator(ClipSubjectSchema)
  .handler(({ data, context: { clickhouse } }) => {
    assertSessionRecordings();
    return new RecordingsRepository({
      execute: (sql, params) => clickhouse.query(sql, params),
    }).coveringClips(data);
  });

const ClipEventsInputSchema = z.object({
  clipId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
});

/**
 * A returned Response crosses the server function boundary untouched, so the
 * events skip the serializer and the browser parses them natively. rrweb JSON
 * shrinks about tenfold under gzip.
 */
export const getClipEvents = createAuthenticatedServerFn({ method: "GET" })
  .validator(ClipEventsInputSchema)
  .handler(async ({ data, context: { session } }) => {
    assertSessionRecordings();
    try {
      const body = JSON.stringify(
        await clipEvents(session.session.activeOrganizationId, data.clipId, data.startMs),
      );
      return new Response(new Blob([body]).stream().pipeThrough(new CompressionStream("gzip")), {
        headers: { "content-type": "application/json", "content-encoding": "gzip" },
      });
    } catch (error) {
      return replayHttpError(error);
    }
  });
