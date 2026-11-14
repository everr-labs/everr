import {
  assertPrivateRepository,
  commentOnGithubIssue,
  countOpenAppIssues,
  createGithubIssue,
  getGithubIssueState,
  githubIssueToken,
  githubRepoFromRepoid,
  reopenGithubIssue,
} from "#app/data/alerting/delivery/providers/github-issues.ts";
import { ChannelSendError } from "#app/data/alerting/delivery/providers/outbound.ts";
import { repositoryForService } from "#app/data/service-repositories/links.server.ts";
import type { AlertingChannelConfig } from "#app/data/alerting/types.ts";
import type { IssueTracker } from "./deliver-issue";
import { capacityReached, missingRepository } from "./issue-holds";

type GithubIssuesConfig = Extract<AlertingChannelConfig, { type: "github_issues" }>;

/** GitHub Issues, written as the organization's App installation. An issue's
 *  location is its `owner/name`, and its id is the issue number. */
export function githubTracker(organizationId: string, config: GithubIssuesConfig): IssueTracker {
  const tokens = new Map<string, Promise<string>>();
  const token = (repo: string) => {
    let pending = tokens.get(repo);
    if (!pending) {
      pending = githubIssueToken(organizationId, repo);
      tokens.set(repo, pending);
    }
    return pending;
  };
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    provider: "github",
    async locate({ repoid, evidence }) {
      // The service's repository wins: an error is fixed where its code
      // lives. The channel's repository and then the rule's are for alerts
      // that name no service, or a service Everr cannot place.
      const service = text(evidence.service);
      const linked = await repositoryForService(organizationId, {
        service,
        repositoryName: text(evidence.repository_name),
        repositoryUrl: text(evidence.repository_url),
        serviceVersion: text(evidence.service_version),
      });
      // Guessing the organization's only repository comes last: a repository
      // the channel or the rule names is a choice, not a guess.
      const guessed = linked?.source === "only_repository";
      const repo =
        (guessed ? null : linked?.repository) ??
        config.repo ??
        githubRepoFromRepoid(repoid) ??
        linked?.repository;
      if (!repo && service) throw missingRepository(service);
      if (!repo) {
        throw new ChannelSendError(
          "no repository for this alert: it names no service, and neither the channel nor the rule names a repository",
          { permanent: true },
        );
      }
      await assertPrivateRepository(await token(repo), repo);
      return repo;
    },
    async checkCapacity(repo) {
      const open = await countOpenAppIssues(
        await token(repo),
        repo,
        config.labels,
        config.max_open,
      );
      if (open >= config.max_open) {
        throw capacityReached(open, repo, config.max_open);
      }
    },
    async create(repo, issue) {
      const created = await createGithubIssue(await token(repo), repo, {
        ...issue,
        labels: config.labels,
        assignees: config.assignees,
      });
      return { id: String(created.number), url: created.url };
    },
    async state(repo, id) {
      const issue = await getGithubIssueState(await token(repo), repo, Number(id));
      if (issue.state === "open") return "open";
      return issue.stateReason === "not_planned" ? "not_planned" : "done";
    },
    async reopen(repo, id) {
      await reopenGithubIssue(await token(repo), repo, Number(id));
    },
    async comment(repo, id, body) {
      await commentOnGithubIssue(await token(repo), repo, Number(id), body);
    },
  };
}
