import type { Span } from "../../data/types";
import { buildTraceModel, type TraceModel } from "./model";
import {
  computeVisualLayout,
  type VisualLayout,
} from "./rendering/compute-visual-layout";
import type { FlamegraphSpan } from "./rendering/types";

export type TraceTask =
  | { type: "model"; spans: Span[] }
  | { type: "layout"; spans: FlamegraphSpan[] };

export type TraceResult =
  | { type: "model"; model: TraceModel }
  | { type: "layout"; layout: VisualLayout };

export type TraceResponse = TraceResult | { type: "error"; message: string };

export function executeTraceTask(task: TraceTask): TraceResult {
  return task.type === "model"
    ? { type: "model", model: buildTraceModel(task.spans) }
    : { type: "layout", layout: computeVisualLayout([task.spans]) };
}
