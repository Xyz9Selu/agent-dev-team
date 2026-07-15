import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CcMmExecutor } from "../src/executor.js";
import type { AdtConfig, RepositoryConfig } from "../src/types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "adt-executor-"));
  dirs.push(worktree);
  const command = path.resolve("tests/fixtures/fake-cc-mm.mjs");
  fs.chmodSync(command, 0o755);
  const repository: RepositoryConfig = { name: "o/r", path: worktree };
  const config: AdtConfig = {
    github: { agentUser: "agent", allowedUsers: ["owner"], pollIntervalSeconds: 20 },
    executor: { kind: "cc-mm", command, maxMinutes: 1 },
    isolation: { enabled: false, command: "bwrap", readOnlyHomePaths: [], writableHomePaths: [] },
    maxConcurrent: 2, retentionDays: 30, repositories: [repository],
  };
  return { worktree, repository, executor: new CcMmExecutor(config) };
}

describe("CcMmExecutor protocol", () => {
  it("runs safety review with no tools", async () => {
    const { executor, repository, worktree } = setup();
    await expect(executor.reviewSafety(repository, worktree, "implement", "context"))
      .resolves.toEqual({ decision: "allow", risks: [], safeTask: "safe normalized task" });
  });

  it("writes a plan, preserves the session, then implements", async () => {
    const { executor, repository, worktree } = setup();
    const planning = await executor.plan(repository, worktree, "implement", "context", "docs/plans/1-test.md");
    expect(planning.result.status).toBe("done");
    expect(fs.existsSync(path.join(worktree, "docs/plans/1-test.md"))).toBe(true);
    const implementation = await executor.implement(repository, worktree, "implement", "context",
      "docs/plans/1-test.md", planning.sessionId);
    expect(implementation.sessionId).toBe(planning.sessionId);
    expect(fs.readFileSync(path.join(worktree, "implemented.txt"), "utf8")).toBe("implemented\n");
  });

  it("returns a structured needs-input checkpoint", async () => {
    const { executor, repository, worktree } = setup();
    const output = await executor.analyze(repository, worktree, "analyze", "context");
    expect(output.result.status).toBe("needs-input");
  });
});
