import type { ClipSubject, SessionRecordingsHost } from "@everr/telemetry-explorer/recordings";
import { RecordingPanel } from "./recording-panel";

/** Another record remounts the panel, so no state of the last one carries over. */
function clipSubjectKey(subject: ClipSubject): string {
  return subject.kind === "trace"
    ? `trace:${subject.traceId}`
    : `log:${subject.streamId}:${subject.at}`;
}

export const sessionRecordingsHost: SessionRecordingsHost = {
  renderPlayer: (subject, placement) => (
    <RecordingPanel key={clipSubjectKey(subject)} subject={subject} placement={placement} />
  ),
};
