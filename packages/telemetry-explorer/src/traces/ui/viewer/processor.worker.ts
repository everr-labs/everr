import {
  executeTraceTask,
  type TraceResponse,
  type TraceTask,
} from "./processor-tasks";

self.onmessage = (event: MessageEvent<TraceTask>) => {
  let response: TraceResponse;
  try {
    response = executeTraceTask(event.data);
  } catch (error) {
    response = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(response);
};
