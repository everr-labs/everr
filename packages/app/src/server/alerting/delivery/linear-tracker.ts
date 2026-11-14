import {
  commentOnLinearIssue,
  countOpenLinearIssues,
  createLinearIssue,
  getLinearIssueState,
  linearLabelIds,
  linearTeamId,
  linearUserId,
  reopenLinearIssue,
} from "#app/data/alerting/delivery/providers/linear.ts";
import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import type { IssueTracker } from "./deliver-issue";
import { capacityReached } from "./issue-holds";

type LinearConfig = Extract<AlertingChannelConfig, { type: "linear" }>;

/** Linear, written with the channel's API key. An issue's location is its
 *  team id, and its id is Linear's issue id. */
export function linearTracker(config: LinearConfig): IssueTracker {
  const key = config.api_key;
  return {
    provider: "linear",
    locate: () => linearTeamId(key, config.team),
    async checkCapacity(_teamId, tracked) {
      const open = await countOpenLinearIssues(key, tracked);
      if (open >= config.max_open) {
        throw capacityReached(open, config.team, config.max_open);
      }
    },
    async create(teamId, issue) {
      const [labelIds, assigneeId] = await Promise.all([
        linearLabelIds(key, teamId, config.labels),
        config.assignee ? linearUserId(key, config.assignee) : undefined,
      ]);
      return createLinearIssue(key, {
        teamId,
        title: issue.title,
        description: issue.body,
        labelIds,
        ...(assigneeId ? { assigneeId } : {}),
      });
    },
    async state(_teamId, id) {
      const issue = await getLinearIssueState(key, id);
      if (issue.type === "canceled") return "not_planned";
      return issue.type === "completed" ? "done" : "open";
    },
    async reopen(_teamId, id) {
      const issue = await getLinearIssueState(key, id);
      await reopenLinearIssue(key, id, issue.teamId);
    },
    async comment(_teamId, id, body) {
      await commentOnLinearIssue(key, id, body);
    },
  };
}
