import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ADT_HOME } from "./config.js";
import type { RepositoryConfig } from "./types.js";

function git(repoPath: string, args: string[]): string {
  return execFileSync("git", ["-C", repoPath, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function defaultBranch(repository: RepositoryConfig): string {
  try {
    const ref = git(repository.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    return ref.replace(/^origin\//, "");
  } catch {
    return "main";
  }
}

export function branchName(number: number, instruction: string): string {
  const slug = instruction.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "task";
  return `api001/issue-${number}-${slug}`;
}

export function ensureWorktree(
  repository: RepositoryConfig,
  number: number,
  branch: string,
  existingBranch: boolean,
): string {
  const repoKey = repository.name.replace("/", "-");
  const destination = path.join(ADT_HOME, "worktrees", repoKey, `thread-${number}`);
  if (fs.existsSync(destination)) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  git(repository.path, ["fetch", "--prune", "origin"]);
  if (existingBranch) {
    git(repository.path, ["fetch", "origin", `${branch}:refs/remotes/origin/${branch}`]);
    const localExists = (() => {
      try { git(repository.path, ["show-ref", "--verify", `refs/heads/${branch}`]); return true; }
      catch { return false; }
    })();
    if (localExists) git(repository.path, ["worktree", "add", destination, branch]);
    else git(repository.path, ["worktree", "add", "-b", branch, destination, `origin/${branch}`]);
  } else {
    git(repository.path, ["worktree", "add", "-b", branch, destination, `origin/${defaultBranch(repository)}`]);
  }
  return destination;
}

export function removeWorktree(repository: RepositoryConfig, worktree: string): void {
  if (!fs.existsSync(worktree)) return;
  git(repository.path, ["worktree", "remove", "--force", worktree]);
}

export function repositoryConfig(repositories: RepositoryConfig[], name: string): RepositoryConfig {
  const repository = repositories.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (!repository) throw new Error(`Repository is not registered: ${name}`);
  return repository;
}
