import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AdtConfig, RepositoryConfig } from "./types.js";

export interface SandboxedCommand {
  command: string;
  args: string[];
  cwd: string;
}

export function sandboxCommand(
  config: AdtConfig,
  repository: RepositoryConfig,
  worktree: string,
  command: string,
  args: string[],
): SandboxedCommand {
  if (!config.isolation.enabled) return { command, args, cwd: worktree };

  const home = os.homedir();
  const bwrapArgs = [
    "--die-with-parent",
    "--new-session",
    "--ro-bind", "/", "/",
    "--tmpfs", "/home",
    "--dir", home,
    "--tmpfs", "/tmp",
    "--proc", "/proc",
    "--dev", "/dev",
    "--ro-bind", repository.path, repository.path,
  ];

  const gitDir = path.join(repository.path, ".git");
  if (fs.existsSync(gitDir)) bwrapArgs.push("--bind", gitDir, gitDir);
  bwrapArgs.push("--bind", worktree, worktree);

  for (const source of config.isolation.readOnlyHomePaths) {
    if (fs.existsSync(source)) bwrapArgs.push("--ro-bind", source, source);
  }
  for (const source of config.isolation.writableHomePaths) {
    if (fs.existsSync(source)) bwrapArgs.push("--bind", source, source);
  }
  const claudeWorktrees = path.join(home, ".claude", "worktrees");
  if (fs.existsSync(claudeWorktrees)) bwrapArgs.push("--tmpfs", claudeWorktrees);

  bwrapArgs.push(
    "--setenv", "HOME", home,
    "--setenv", "ADT_SANDBOX", "1",
    "--chdir", worktree,
    "--", command, ...args,
  );
  return { command: config.isolation.command, args: bwrapArgs, cwd: worktree };
}
