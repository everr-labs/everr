import { productClient } from "@composition/client";
import type { ClipSubject, SessionRecordingsHost } from "@everr/telemetry-explorer/recordings";
import { RecordingPanel } from "./recording-panel";

/** Another record remounts the panel, so no state of the last one carries over. */
function clipSubjectKey(subject: ClipSubject): string {
  return subject.kind === "trace"
    ? `trace:${subject.traceId}`
    : `log:${subject.streamId}:${subject.at}`;
}

/** Undefined where recordings are not stored: the shared pages then draw no switch and no player. */
export const sessionRecordingsHost: SessionRecordingsHost | undefined =
  productClient.sessionRecordings
    ? {
        renderPlayer: (subject, placement) => (
          <RecordingPanel key={clipSubjectKey(subject)} subject={subject} placement={placement} />
        ),
      }
    : undefined;
