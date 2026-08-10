import { z } from "zod";

export const ALERT_PROCESS_EVENT_TASK = "alerts/process-event";
export const ALERT_FLUSH_GROUP_TASK = "alerts/flush-group";
export const ALERT_SEND_DELIVERY_TASK = "alerts/send-delivery";

export const AlertEventTaskPayloadSchema = z.object({
  eventId: z.string().uuid(),
});

export const AlertGroupTaskPayloadSchema = z.object({
  groupId: z.string().uuid(),
});

export const AlertDeliveryTaskPayloadSchema = z.object({
  dedupKey: z.string().min(1),
});

export const IDLE_GROUP_FLUSH_AT = new Date("9999-12-31T23:59:59.999Z");
