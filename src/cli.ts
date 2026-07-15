#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { Command } from "commander";
import { loadConfig, writeExampleConfig } from "./config.js";
import { allJobs, findWorkspace, getJob, openStore, requestCancel, transition } from "./store.js";
import { Worker } from "./worker.js";
import { authenticatedUser, githubClient, postComment, threadContext } from "./github.js";
import { branchName, ensureWorktree, removeWorktree, repositoryConfig } from "./workspace.js";
import { sandboxCommand } from "./sandbox.js";
import { CcMmExecutor } from "./executor.js";
import { colorEnabled, renderStatusTable } from "./statusFormat.js";

const program = new Command();
program.name("adt").description("Mention-driven GitHub development assistant").version("0.2.0");

program.command("init")
  .description("Write a starter configuration to ~/.adt/config.json")
  .action(() => {
    writeExampleConfig();
    console.log("Created ~/.adt/config.json. Add repositories before running adt watch.");
  });

program.command("watch")
  .description("Poll GitHub and execute queued @mentions")
  .option("--once", "Poll and schedule once")
  .action(async ({ once }: { once?: boolean }) => {
    const config = loadConfig();
    const worker = new Worker(config);
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      do {
        try { await worker.tick(); }
        catch (error) { console.error(`[adt] poll failed: ${error instanceof Error ? error.message : String(error)}`); }
        if (once) {
          while (worker.activeCount > 0) await sleep(100);
          break;
        }
        if (!stopping) await sleep(config.github.pollIntervalSeconds * 1000);
      } while (!stopping);
    } finally {
      await worker.shutdown();
    }
  });

program.command("doctor")
  .description("Check configuration, GitHub identity, repositories and executor prerequisites")
  .action(async () => {
    const config = loadConfig();
    let failed = false;
    const check = (ok: boolean, message: string) => {
      console.log(`${ok ? "✓" : "✗"} ${message}`);
      if (!ok) failed = true;
    };
    const client = githubClient();
    const login = await authenticatedUser(client);
    check(login.toLowerCase() === config.github.agentUser.toLowerCase(),
      `GitHub login: ${login} (expected ${config.github.agentUser})`);
    check(commandExists(config.executor.command), `Executor: ${config.executor.command}`);
    if (config.isolation.enabled) {
      const installed = commandExists(config.isolation.command);
      check(installed, `Sandbox installed: ${config.isolation.command}`);
      if (installed) {
        const probe = spawnSync(config.isolation.command,
          ["--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--", "/usr/bin/true"],
          { encoding: "utf8" });
        check(probe.status === 0,
          probe.status === 0
            ? "Sandbox can create a user namespace"
            : `Sandbox cannot create a user namespace: ${(probe.stderr || "unknown error").trim()}`);
      }
    }
    for (const repository of config.repositories) {
      const probe = spawnSync("git", ["-C", repository.path, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
      check(probe.status === 0, `Repository ${repository.name}: ${repository.path}`);
    }
    if (config.repositories.length === 0) check(false, "At least one repository is configured");
    if (failed) process.exitCode = 1;
  });

program.command("status")
  .description("Show the ADT task queue")
  .option("--watch", "Refresh continuously")
  .action(async ({ watch }: { watch?: boolean }) => {
    const config = loadConfig();
    do {
      const db = openStore();
      const jobs = allJobs(db, 50);
      db.close();
      if (watch) process.stdout.write("\x1Bc");
      const colorOn = colorEnabled({
        isTTY: Boolean(process.stdout.isTTY),
        noColor: process.env.NO_COLOR !== undefined,
      });
      for (const line of renderStatusTable(jobs, config.executor.kind, colorOn)) {
        console.log(line);
      }
      if (watch) await sleep(2000);
    } while (watch);
  });

program.command("cancel <taskId>")
  .description("Cancel a task while preserving its workspace")
  .action((taskId: string) => {
    const id = parseTaskId(taskId);
    const db = openStore();
    const job = getJob(db, id);
    if (!job) throw new Error(`Unknown task A-${id}`);
    requestCancel(db, id);
    db.close();
    console.log(`Cancellation requested for A-${id}.`);
  });

program.command("retry <taskId>")
  .description("Queue a failed or cancelled task again")
  .action((taskId: string) => {
    const id = parseTaskId(taskId);
    const db = openStore();
    const job = getJob(db, id);
    if (!job) throw new Error(`Unknown task A-${id}`);
    if (!["failed", "cancelled", "needs-input"].includes(job.status)) throw new Error(`Task A-${id} is ${job.status}`);
    transition(db, id, "queued", job.phase);
    db.close();
    console.log(`Queued A-${id}.`);
  });

program.command("clean")
  .description("Remove retained worktrees for finished tasks")
  .action(() => {
    const config = loadConfig();
    const db = openStore();
    let removed = 0;
    for (const job of allJobs(db, 10_000)) {
      if (!job.worktree_path || !["done", "failed", "cancelled"].includes(job.status)) continue;
      removeWorktree(repositoryConfig(config.repositories, job.repo), job.worktree_path);
      db.prepare("UPDATE jobs SET worktree_path = NULL WHERE id = ?").run(job.id);
      removed += 1;
    }
    db.close();
    console.log(`Removed ${removed} worktree(s).`);
  });

program.command("grill <ref>")
  .description("Open a synchronous executor TUI for owner/repo#number")
  .action(async (ref: string) => {
    const { repo, number } = parseRef(ref);
    const config = loadConfig();
    const repository = repositoryConfig(config.repositories, repo);
    const db = openStore();
    const previous = findWorkspace(db, repo, number);
    const branch = previous?.branch ?? branchName(number, "grill");
    const worktree = previous?.worktree_path ?? ensureWorktree(repository, number, branch, false);
    db.close();
    const client = githubClient();
    const context = await threadContext(client, repo, number);
    const sessionId = crypto.randomUUID();
    const prompt = `Conduct a synchronous requirements grill for ${repo}#${number}. Read the repository and this GitHub context. Ask focused questions interactively. Do not modify files. At the end, ensure the conversation contains requirements, acceptance criteria, and open questions.\n\n${context.slice(-40_000)}`;
    const command = sandboxCommand(config, repository, worktree, config.executor.command, [
      "--session-id", sessionId, "--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk", prompt,
    ]);
    const result = spawnSync(command.command, command.args, { cwd: command.cwd, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Grill session exited ${result.status}`);
    const executor = new CcMmExecutor(config);
    const summary = await executor.analyze(repository, worktree,
      "Summarize the completed grill. Include requirements, acceptance criteria, and unresolved questions. Do not ask a new round unless something remains unresolved.", context, sessionId);
    const body = summary.result.status === "needs-input"
      ? [summary.result.summary, ...summary.result.questions.map((question) => `- ${question}`)].join("\n")
      : summary.result.summary;
    await postComment(client, repo, number, `## api001 Grill 总结\n\n${body}`);
    console.log("Grill summary posted to GitHub.");
  });

program.parseAsync().catch((error) => {
  console.error(`adt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

function parseTaskId(value: string): number {
  const id = Number(value.replace(/^A-/i, ""));
  if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid task ID: ${value}`);
  return id;
}

function parseRef(value: string): { repo: string; number: number } {
  const match = /^([^/]+\/[^#]+)#(\d+)$/.exec(value);
  if (!match) throw new Error("Use owner/repo#number");
  return { repo: match[1], number: Number(match[2]) };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function commandExists(command: string): boolean {
  if (command.includes("/")) {
    try { fs.accessSync(command, fs.constants.X_OK); return true; }
    catch { return false; }
  }
  return spawnSync("sh", ["-c", "command -v \"$1\" >/dev/null", "sh", command]).status === 0;
}
