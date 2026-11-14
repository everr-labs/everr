import { ChannelSendError } from "#app/data/alerting/delivery/providers/outbound.ts";

/** Why an issue waits instead of opening. Each stops being true on its own,
 *  so the delivery is kept to send again rather than given up. */
export type IssueHoldReason = "repository" | "capacity";

/** A permanent failure for now, that a later send can get past. */
export class IssueHoldError extends ChannelSendError {
  readonly reason: IssueHoldReason;
  readonly service: string | null;

  constructor(message: string, reason: IssueHoldReason, service: string | null) {
    super(message, { permanent: true });
    this.name = "IssueHoldError";
    this.reason = reason;
    this.service = service;
  }
}

/** Everr knows no repository for the error's service, until someone links it. */
export function missingRepository(service: string): IssueHoldError {
  return new IssueHoldError(
    `waiting for a repository: link ${service} to its repository and the issue opens`,
    "repository",
    service,
  );
}

/** The channel's limit of open issues is reached, until one of them closes. */
export function capacityReached(open: number, where: string, max: number): IssueHoldError {
  return new IssueHoldError(
    `waiting: ${open} Everr issues are already open in ${where}, the channel's limit is ${max}. It opens when one closes`,
    "capacity",
    null,
  );
}
