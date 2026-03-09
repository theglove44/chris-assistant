import type { Issue, Tracker } from "../types.js";

export class MemoryTracker implements Tracker {
  constructor(private readonly issues: Issue[] = []) {}

  async fetchCandidateIssues(): Promise<Issue[]> {
    return this.issues;
  }

  async fetchIssuesByStates(states: string[]): Promise<Issue[]> {
    const wanted = new Set(states.map((state) => state.trim().toLowerCase()));
    return this.issues.filter((issue) => wanted.has(issue.state.trim().toLowerCase()));
  }

  async fetchIssueStatesByIds(ids: string[]): Promise<Issue[]> {
    const wanted = new Set(ids);
    return this.issues.filter((issue) => wanted.has(issue.id));
  }

  async createComment(_issueId: string, _body: string): Promise<void> {}
  async updateIssueState(_issueId: string, _stateName: string): Promise<void> {}
}
