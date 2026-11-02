import { runtime } from "@composition/runtime";
import { createEventPublisher } from "./publisher";

export const events = createEventPublisher({ routes: runtime.events });
