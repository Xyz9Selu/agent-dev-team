import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import type { AdtConfig, JobStatus, TriggerEvent } from "./types.js";

const STATUS_LABELS: Record<JobStatus, { color: string; description: string }> = {
  queued: { color: "d4c5f9", description: "Agent task is queued" },
  running: { color: "1d76db", description: "Agent task is running" },
  "needs-input": { color: "fbca04", description: "Agent is waiting for human input" },
  done: { color: "0e8a16", description: "Agent task completed" },
  failed: { color: "d93f0b", description: "Agent task failed" },
  cancelled: { color: "6a737d", description: "Agent task was cancelled" },
};

export function githubToken(): string {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("No GitHub token. Set GH_TOKEN or run 'gh auth login'.");
  }
}

export function githubClient(token = githubToken()): Octokit {
  return new Octokit({ auth: token });
}

export async function authenticatedUser(client: Octokit): Promise<string> {
  const result = await client.rest.users.getAuthenticated();
  return result.data.login;
}

function splitRepo(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repository: ${repo}`);
  return { owner, repo: name };
}

export async function ensureStatusLabels(client: Octokit, repoName: string): Promise<void> {
  const repo = splitRepo(repoName);
  const existing = await client.paginate(client.rest.issues.listLabelsForRepo, { ...repo, per_page: 100 });
  const names = new Set(existing.map((label) => label.name));
  for (const [status, metadata] of Object.entries(STATUS_LABELS)) {
    const name = `agent:${status}`;
    if (!names.has(name)) await client.rest.issues.createLabel({ ...repo, name, ...metadata });
  }
}

export async function setStatusLabel(
  client: Octokit,
  repoName: string,
  number: number,
  status: JobStatus,
): Promise<void> {
  const repo = splitRepo(repoName);
  const labels = await client.paginate(client.rest.issues.listLabelsOnIssue, { ...repo, issue_number: number, per_page: 100 });
  for (const label of labels) {
    if (label.name.startsWith("agent:")) {
      await client.rest.issues.removeLabel({ ...repo, issue_number: number, name: label.name }).catch(() => undefined);
    }
  }
  await client.rest.issues.addLabels({ ...repo, issue_number: number, labels: [`agent:${status}`] });
}

export async function postComment(client: Octokit, repoName: string, number: number, body: string): Promise<void> {
  await client.rest.issues.createComment({ ...splitRepo(repoName), issue_number: number, body });
}

export async function addEyesReaction(client: Octokit, event: TriggerEvent): Promise<void> {
  const repo = splitRepo(event.repo);
  if (event.kind === "issue-comment") {
    await client.rest.reactions.createForIssueComment({ ...repo, comment_id: event.id, content: "eyes" });
  } else if (event.kind === "review-comment") {
    await client.rest.reactions.createForPullRequestReviewComment({ ...repo, comment_id: event.id, content: "eyes" });
  }
}

export async function pollEvents(
  client: Octokit,
  config: AdtConfig,
  repoName: string,
  since: string,
): Promise<TriggerEvent[]> {
  const repo = splitRepo(repoName);
  const events: TriggerEvent[] = [];
  const pulls = await client.paginate(client.rest.pulls.list, { ...repo, state: "open", per_page: 100 });
  const pullNumbers = new Set(pulls.map((pull) => pull.number));
  const comments = await client.paginate(client.rest.issues.listCommentsForRepo, {
    ...repo, since, sort: "created", direction: "asc", per_page: 100,
  });
  for (const comment of comments) {
    const body = comment.body ?? "";
    if (!body.toLowerCase().includes(`@${config.github.agentUser.toLowerCase()}`)) continue;
    const number = Number(comment.issue_url.split("/").at(-1));
    events.push({
      repo: repoName, kind: "issue-comment", id: comment.id, number,
      author: comment.user?.login ?? "", body, url: comment.html_url,
      createdAt: comment.created_at, isPullRequest: pullNumbers.has(number),
    });
  }

  for (const pull of pulls) {
    const [reviews, reviewComments] = await Promise.all([
      client.paginate(client.rest.pulls.listReviews, { ...repo, pull_number: pull.number, per_page: 100 }),
      client.paginate(client.rest.pulls.listReviewComments, { ...repo, pull_number: pull.number, per_page: 100 }),
    ]);
    for (const review of reviews) {
      const body = review.body ?? "";
      if (!review.submitted_at || review.submitted_at < since) continue;
      if (!body.toLowerCase().includes(`@${config.github.agentUser.toLowerCase()}`)) continue;
      events.push({ repo: repoName, kind: "review", id: review.id, number: pull.number,
        author: review.user?.login ?? "", body, url: pull.html_url,
        createdAt: review.submitted_at, isPullRequest: true });
    }
    for (const comment of reviewComments) {
      const body = comment.body;
      if (comment.created_at < since) continue;
      if (!body.toLowerCase().includes(`@${config.github.agentUser.toLowerCase()}`)) continue;
      events.push({ repo: repoName, kind: "review-comment", id: comment.id, number: pull.number,
        author: comment.user?.login ?? "", body, url: comment.html_url,
        createdAt: comment.created_at, isPullRequest: true });
    }
  }
  return events.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function threadContext(client: Octokit, repoName: string, number: number): Promise<string> {
  const repo = splitRepo(repoName);
  const issue = await client.rest.issues.get({ ...repo, issue_number: number });
  const comments = await client.paginate(client.rest.issues.listComments, { ...repo, issue_number: number, per_page: 100 });
  return [
    `# ${issue.data.title}`,
    issue.data.body ?? "",
    ...comments.map((comment) => `\n## ${comment.user?.login ?? "unknown"}\n${comment.body ?? ""}`),
  ].join("\n");
}

export async function itemTitle(client: Octokit, repoName: string, number: number): Promise<string> {
  const result = await client.rest.issues.get({ ...splitRepo(repoName), issue_number: number });
  return result.data.title;
}

export async function prMerged(client: Octokit, repoName: string, prNumber: number): Promise<boolean> {
  const result = await client.rest.pulls.get({ ...splitRepo(repoName), pull_number: prNumber });
  return result.data.merged_at !== null;
}

export async function pullRequestInfo(client: Octokit, repoName: string, prNumber: number) {
  const result = await client.rest.pulls.get({ ...splitRepo(repoName), pull_number: prNumber });
  return { branch: result.data.head.ref, base: result.data.base.ref, issueNumber: prNumber };
}

export async function createDraftPullRequest(
  client: Octokit,
  repoName: string,
  head: string,
  base: string,
  title: string,
  body: string,
): Promise<{ number: number; url: string }> {
  const result = await client.rest.pulls.create({ ...splitRepo(repoName), head, base, title, body, draft: true });
  return { number: result.data.number, url: result.data.html_url };
}
