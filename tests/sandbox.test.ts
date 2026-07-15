import { describe, expect, it } from "vitest";
import { sandboxCommand } from "../src/sandbox.js";
import type { AdtConfig } from "../src/types.js";

const config: AdtConfig = {
  github: { agentUser: "agent", allowedUsers: ["owner"], allowSelfTrigger: false, pollIntervalSeconds: 20 },
  executor: { kind: "cc-mm", command: "cc-mm", maxMinutes: 60 },
  isolation: { enabled: true, command: "bwrap", readOnlyHomePaths: [], writableHomePaths: [] },
  maxConcurrent: 2,
  retentionDays: 30,
  repositories: [{ name: "o/r", path: "/repo" }],
};

describe("sandboxCommand", () => {
  it("wraps the executor and preserves network by not unsharing it", () => {
    const command = sandboxCommand(config, config.repositories[0], "/worktree", "cc-mm", ["-p", "hi"]);
    expect(command.command).toBe("bwrap");
    expect(command.args).toContain("--tmpfs");
    expect(command.args).not.toContain("--unshare-net");
    expect(command.args.slice(-3)).toEqual(["cc-mm", "-p", "hi"]);
  });

  it("can be disabled for diagnostics", () => {
    const command = sandboxCommand({ ...config, isolation: { ...config.isolation, enabled: false } },
      config.repositories[0], "/worktree", "cc-mm", ["--help"]);
    expect(command).toEqual({ command: "cc-mm", args: ["--help"], cwd: "/worktree" });
  });
});
