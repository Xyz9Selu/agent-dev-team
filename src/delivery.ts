import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import type { RepositoryConfig } from "./types.js";
import { createDraftPullRequest } from "./github.js";
import { defaultBranch } from "./workspace.js";

function git(worktree: string, args: string[]): string {
  return execFileSync("git", ["-C", worktree, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function hasChanges(worktree: string): boolean {
  return git(worktree, ["status", "--porcelain"]).length > 0;
}

export async function deliver(
  client: Octokit,
  repository: RepositoryConfig,
  worktree: string,
  branch: string,
  number: number,
  title: string,
  summary: string,
  tests: string[],
  agentUser: string,
  existingPrNumber?: number | null,
): Promise<{ prNumber: number; url: string; commit: string }> {
  if (!hasChanges(worktree)) throw new Error("Executor completed without producing changes");
  git(worktree, ["add", "-A"]);
  git(worktree, ["-c", `user.name=${agentUser}`, "-c", `user.email=${agentUser}@users.noreply.github.com`, "commit", "-m", `Implement #${number}: ${title.slice(0, 60)}`]);
  const commit = git(worktree, ["rev-parse", "HEAD"]);
  git(worktree, ["push", "-u", "origin", branch]);

  if (existingPrNumber) {
    return { prNumber: existingPrNumber, url: `https://github.com/${repository.name}/pull/${existingPrNumber}`, commit };
  }
  const body = [
    `Closes #${number}`,
    "",
    "## Summary",
    summary,
    "",
    "## Validation",
    ...(tests.length > 0 ? tests.map((test) => `- ${test}`) : ["- No test result was reported"]),
    "",
    `_Created by ADT as ${agentUser}._`,
  ].join("\n");
  const pr = await createDraftPullRequest(client, repository.name, branch, defaultBranch(repository), title, body);
  return { prNumber: pr.number, url: pr.url, commit };
}

export function planRelativePath(number: number, instruction: string): string {
  const slug = instruction.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "implementation";
  return path.join("docs", "plans", `${number}-${slug}.md`);
}

export function ensurePlanDirectory(worktree: string, planPath: string): void {
  fs.mkdirSync(path.dirname(path.join(worktree, planPath)), { recursive: true });
}
