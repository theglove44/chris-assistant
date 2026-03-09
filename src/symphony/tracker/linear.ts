import type { Issue, SymphonyConfig, Tracker } from "../types.js";

const CANDIDATE_QUERY = `
query SymphonyLinearPoll($projectSlug: String!, $stateNames: [String!]!, $first: Int!, $relationFirst: Int!, $after: String) {
  issues(filter: {project: {slugId: {eq: $projectSlug}}, state: {name: {in: $stateNames}}}, first: $first, after: $after) {
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      branchName
      url
      assignee { id }
      labels { nodes { name } }
      inverseRelations(first: $relationFirst) {
        nodes {
          type
          issue {
            id
            identifier
            state { name }
          }
        }
      }
      createdAt
      updatedAt
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const ISSUE_STATES_QUERY = `
query SymphonyLinearIssuesById($ids: [ID!]!, $first: Int!, $relationFirst: Int!) {
  issues(filter: {id: {in: $ids}}, first: $first) {
    nodes {
      id
      identifier
      title
      description
      priority
      state { name }
      branchName
      url
      assignee { id }
      labels { nodes { name } }
      inverseRelations(first: $relationFirst) {
        nodes {
          type
          issue {
            id
            identifier
            state { name }
          }
        }
      }
      createdAt
      updatedAt
    }
  }
}
`;

const CREATE_COMMENT_MUTATION = `
mutation SymphonyCreateComment($issueId: String!, $body: String!) {
  commentCreate(input: {issueId: $issueId, body: $body}) {
    success
  }
}
`;

const UPDATE_STATE_MUTATION = `
mutation SymphonyUpdateIssueState($issueId: String!, $stateId: String!) {
  issueUpdate(id: $issueId, input: {stateId: $stateId}) {
    success
  }
}
`;

const STATE_LOOKUP_QUERY = `
query SymphonyResolveStateId($issueId: String!, $stateName: String!) {
  issue(id: $issueId) {
    team {
      states(filter: {name: {eq: $stateName}}, first: 1) {
        nodes { id }
      }
    }
  }
}
`;

export class LinearTracker implements Tracker {
  constructor(private readonly config: SymphonyConfig) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.fetchByStates(this.config.tracker.activeStates);
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    return this.fetchByStates(states);
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    if (ids.length === 0) return [];
    const body = await this.graphql(ISSUE_STATES_QUERY, {
      ids,
      first: Math.min(ids.length, 50),
      relationFirst: 50,
    });
    return normalizeIssueList(body);
  }

  async createComment(issueId: string, body: string): Promise<void> {
    const result = await this.graphql(CREATE_COMMENT_MUTATION, { issueId, body });
    if (result.data?.commentCreate?.success !== true) {
      throw new Error("Linear commentCreate failed");
    }
  }

  async updateIssueState(issueId: string, stateName: string): Promise<void> {
    const lookup = await this.graphql(STATE_LOOKUP_QUERY, { issueId, stateName });
    const stateId = lookup.data?.issue?.team?.states?.nodes?.[0]?.id;
    if (!stateId) {
      throw new Error(`Linear state lookup failed for "${stateName}"`);
    }

    const result = await this.graphql(UPDATE_STATE_MUTATION, { issueId, stateId });
    if (result.data?.issueUpdate?.success !== true) {
      throw new Error("Linear issueUpdate failed");
    }
  }

  async graphql(query: string, variables: Record<string, unknown> = {}): Promise<Record<string, any>> {
    const response = await fetch(this.config.tracker.endpoint, {
      method: "POST",
      headers: {
        Authorization: this.config.tracker.apiKey || "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(`Linear GraphQL ${response.status}: ${JSON.stringify(body)}`);
    }
    if (body.errors) {
      throw new Error(`Linear GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    return body;
  }

  private async fetchByStates(states: string[]): Promise<Issue[]> {
    const results: Issue[] = [];
    let after: string | null = null;

    while (true) {
      const body = await this.graphql(CANDIDATE_QUERY, {
        projectSlug: this.config.tracker.projectSlug,
        stateNames: states,
        first: 50,
        relationFirst: 50,
        after,
      });

      results.push(...normalizeIssueList(body).filter((issue) => this.matchesAssignee(issue)));

      const pageInfo = body.data?.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
      after = pageInfo.endCursor;
    }

    return results;
  }

  private matchesAssignee(issue: Issue): boolean {
    if (!this.config.tracker.assignee) return true;
    if (this.config.tracker.assignee === "me") return issue.assignedToWorker;
    return issue.assigneeId === this.config.tracker.assignee;
  }
}

function normalizeIssueList(body: Record<string, any>): Issue[] {
  const nodes = body.data?.issues?.nodes;
  if (!Array.isArray(nodes)) return [];

  return nodes.map(normalizeIssue).filter((issue): issue is Issue => !!issue);
}

function normalizeIssue(issue: Record<string, any> | null | undefined): Issue | null {
  if (!issue?.id || !issue.identifier || !issue.title || !issue.state?.name) return null;

  return {
    id: String(issue.id),
    identifier: String(issue.identifier),
    title: String(issue.title),
    description: typeof issue.description === "string" ? issue.description : null,
    priority: typeof issue.priority === "number" ? issue.priority : null,
    state: String(issue.state.name),
    branchName: typeof issue.branchName === "string" ? issue.branchName : null,
    url: typeof issue.url === "string" ? issue.url : null,
    labels: Array.isArray(issue.labels?.nodes)
      ? issue.labels.nodes.map((label: any) => String(label?.name || "").toLowerCase()).filter(Boolean)
      : [],
    blockedBy: Array.isArray(issue.inverseRelations?.nodes)
      ? issue.inverseRelations.nodes
        .filter((relation: any) => String(relation?.type || "").trim().toLowerCase() === "blocks")
        .map((relation: any) => ({
          id: relation.issue?.id ? String(relation.issue.id) : null,
          identifier: relation.issue?.identifier ? String(relation.issue.identifier) : null,
          state: relation.issue?.state?.name ? String(relation.issue.state.name) : null,
        }))
      : [],
    assigneeId: issue.assignee?.id ? String(issue.assignee.id) : null,
    assignedToWorker: !!issue.assignee?.id,
    createdAt: typeof issue.createdAt === "string" ? issue.createdAt : null,
    updatedAt: typeof issue.updatedAt === "string" ? issue.updatedAt : null,
  };
}
