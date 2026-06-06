import * as z from "zod";
import type {
  AlertEventType,
  AlertSeverity,
  AlertStateStatus,
} from "@/server/alerts/repository";

export type AlertRuleListItem = {
  id: number;
  service: string;
  name: string;
  severity: AlertSeverity;
  routingSlug: string;
  evaluationIntervalSeconds: number;
  windowSeconds: number;
  active: boolean;
  sourceUrl: string;
  lastEvaluationStatus: string | null;
  lastEvaluationError: string | null;
  stateStatus: AlertStateStatus | null;
  updatedAt: string;
};

export type AlertEvidenceValue = string | number | boolean | null;
export type AlertEvidenceRow = Record<string, AlertEvidenceValue>;

export type ActiveAlertListItem = {
  alertDefinitionId: number;
  service: string;
  name: string;
  severity: AlertSeverity;
  routingSlug: string;
  status: AlertStateStatus;
  firstFiredAt: string | null;
  lastSeenAt: string | null;
  rowCount: number;
  evidence: AlertEvidenceRow[];
  evidenceTruncated: boolean;
  sourceUrl: string;
};

export type AlertEventListItem = {
  id: number;
  alertDefinitionId: number;
  service: string;
  name: string;
  severity: AlertSeverity;
  type: AlertEventType;
  summary: string;
  description: string | null;
  occurredAt: string;
  rowCount: number;
  sourceUrl: string;
};

export type AlertRoutingListMember = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

export type RoutingListItem = {
  slug: string;
  name: string;
  builtIn: boolean;
  members: AlertRoutingListMember[];
};

export const SaveRoutingListInputSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1),
  userIds: z.array(z.string().trim().min(1)).default([]),
});

export type SaveRoutingListInput = z.infer<typeof SaveRoutingListInputSchema>;
