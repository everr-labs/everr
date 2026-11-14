import { ChannelSendError, isPermanentStatus } from "./outbound";

const LINEAR_API = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_MS = 10_000;

/** Where a Linear issue stands, in the workflow state types Linear uses. */
export type LinearIssueState = { type: string; teamId: string };

/**
 * One GraphQL call with the outcome classified for the send job. Linear
 * answers most failures with HTTP 200 and an `errors` list, so both are read.
 * Neither the response body nor the API key reaches the error text, which is
 * stored in the delivery trail.
 */
async function linearRequest<T>(
  apiKey: string,
  label: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(LINEAR_API, {
      method: "POST",
      headers: { Authorization: apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ChannelSendError(`Linear ${label} failed: network`, { permanent: false });
  }
  if (!response.ok && response.status !== 400) {
    await response.body?.cancel().catch(() => undefined);
    const reason =
      response.status === 401 || response.status === 403
        ? "the API key was rejected"
        : String(response.status);
    throw new ChannelSendError(`Linear ${label} failed: ${reason}`, {
      permanent: isPermanentStatus(response.status),
      status: response.status,
    });
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- The Linear GraphQL contract for this query; callers read only the fields they selected.
  const payload = (await response.json()) as {
    data?: T;
    errors?: { extensions?: { code?: string; type?: string } }[];
  };
  if (payload.errors && payload.errors.length > 0) {
    const code = payload.errors[0]?.extensions?.code ?? payload.errors[0]?.extensions?.type ?? "";
    const rateLimited = code.toUpperCase() === "RATELIMITED";
    const auth = /authentication|forbidden/i.test(code);
    throw new ChannelSendError(
      `Linear ${label} failed: ${auth ? "the API key was rejected" : code || "error"}`,
      { permanent: !rateLimited },
    );
  }
  if (!payload.data) {
    throw new ChannelSendError(`Linear ${label} failed: empty response`, { permanent: false });
  }
  return payload.data;
}

export async function linearTeamId(apiKey: string, teamKey: string): Promise<string> {
  const data = await linearRequest<{ teams: { nodes: { id: string }[] } }>(
    apiKey,
    "team lookup",
    `query Team($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`,
    { key: teamKey },
  );
  const team = data.teams.nodes[0];
  if (!team) {
    throw new ChannelSendError(
      `the Linear team ${teamKey} does not exist or the key cannot see it`,
      {
        permanent: true,
      },
    );
  }
  return team.id;
}

/**
 * The ids of the labels to put on an issue, creating the ones the team does
 * not have yet. A label may live on the team or on the whole workspace.
 */
export async function linearLabelIds(
  apiKey: string,
  teamId: string,
  names: string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  const data = await linearRequest<{
    issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] };
  }>(
    apiKey,
    "label lookup",
    `query Labels($names: [String!]) {
      issueLabels(filter: { name: { in: $names } }, first: 100) {
        nodes { id name team { id } }
      }
    }`,
    { names },
  );
  const usable = data.issueLabels.nodes.filter((label) => !label.team || label.team.id === teamId);
  const ids: string[] = [];
  for (const name of names) {
    const found = usable.find((label) => label.name.toLowerCase() === name.toLowerCase());
    if (found) {
      ids.push(found.id);
      continue;
    }
    const created = await linearRequest<{ issueLabelCreate: { issueLabel: { id: string } } }>(
      apiKey,
      "label create",
      `mutation CreateLabel($name: String!, $teamId: String!) {
        issueLabelCreate(input: { name: $name, teamId: $teamId }) { issueLabel { id } }
      }`,
      { name, teamId },
    );
    ids.push(created.issueLabelCreate.issueLabel.id);
  }
  return ids;
}

/**
 * The user to assign, matched by email or by name. An agent is a user in
 * Linear, and assigning an issue to it delegates the issue.
 */
export async function linearUserId(apiKey: string, who: string): Promise<string> {
  const data = await linearRequest<{ users: { nodes: { id: string }[] } }>(
    apiKey,
    "user lookup",
    `query User($who: String!) {
      users(filter: { or: [
        { email: { eqIgnoreCase: $who } },
        { displayName: { eqIgnoreCase: $who } },
        { name: { eqIgnoreCase: $who } }
      ] }, first: 2) { nodes { id } }
    }`,
    { who },
  );
  if (data.users.nodes.length !== 1) {
    throw new ChannelSendError(
      data.users.nodes.length === 0
        ? `no Linear user or agent is named ${who}`
        : `more than one Linear user matches ${who}, use an email`,
      { permanent: true },
    );
  }
  return data.users.nodes[0].id;
}

/** How many of these issues are still open: not completed and not canceled. */
export async function countOpenLinearIssues(apiKey: string, issueIds: string[]): Promise<number> {
  if (issueIds.length === 0) return 0;
  const data = await linearRequest<{ issues: { nodes: { id: string }[] } }>(
    apiKey,
    "issue count",
    `query Open($ids: [ID!]) {
      issues(
        filter: { id: { in: $ids }, state: { type: { nin: ["completed", "canceled"] } } },
        first: 250
      ) { nodes { id } }
    }`,
    { ids: issueIds },
  );
  return data.issues.nodes.length;
}

export async function createLinearIssue(
  apiKey: string,
  issue: {
    teamId: string;
    title: string;
    description: string;
    labelIds: string[];
    assigneeId?: string;
  },
): Promise<{ id: string; url: string }> {
  const data = await linearRequest<{ issueCreate: { issue: { id: string; url: string } } }>(
    apiKey,
    "issue create",
    `mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) { issue { id url } }
    }`,
    { input: issue },
  );
  return data.issueCreate.issue;
}

export async function getLinearIssueState(
  apiKey: string,
  issueId: string,
): Promise<LinearIssueState> {
  const data = await linearRequest<{
    issue: { state: { type: string }; team: { id: string } } | null;
  }>(
    apiKey,
    "issue read",
    `query Issue($id: String!) { issue(id: $id) { state { type } team { id } } }`,
    { id: issueId },
  );
  if (!data.issue) {
    throw new ChannelSendError("the Linear issue no longer exists", { permanent: true });
  }
  return { type: data.issue.state.type, teamId: data.issue.team.id };
}

/** Move an issue back to the team's first not-started state. */
export async function reopenLinearIssue(
  apiKey: string,
  issueId: string,
  teamId: string,
): Promise<void> {
  const data = await linearRequest<{
    workflowStates: { nodes: { id: string; type: string; position: number }[] };
  }>(
    apiKey,
    "state lookup",
    `query States($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 100) {
        nodes { id type position }
      }
    }`,
    { teamId },
  );
  const order = ["unstarted", "backlog", "triage"];
  const target = order
    .map(
      (type) =>
        data.workflowStates.nodes
          .filter((state) => state.type === type)
          .sort((a, b) => a.position - b.position)[0],
    )
    .find(Boolean);
  if (!target) {
    throw new ChannelSendError("the Linear team has no open workflow state to reopen into", {
      permanent: true,
    });
  }
  await linearRequest(
    apiKey,
    "issue reopen",
    `mutation Reopen($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success }
    }`,
    { id: issueId, stateId: target.id },
  );
}

export async function commentOnLinearIssue(
  apiKey: string,
  issueId: string,
  body: string,
): Promise<void> {
  await linearRequest(
    apiKey,
    "issue comment",
    `mutation Comment($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body },
  );
}
