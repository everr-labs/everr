import { serviceColor } from "../../traces/ui/shared/service-color";
import { framePackage } from "../model/flame-layout";

/** A stable theme token for the frame, shared with the trace service palette. */
export function frameColor(name: string): string {
  return serviceColor(framePackage(name));
}
