import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runProcess } from "../src/process.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("runProcess", () => {
  it("terminates descendants when a process times out", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "adt-process-"));
    dirs.push(cwd);

    const result = await runProcess("/bin/bash", [
      "-c",
      "sleep 60 & echo $! > child.pid; wait",
    ], { cwd, timeoutMs: 200 });

    expect(result.timedOut).toBe(true);
    const childPid = Number(fs.readFileSync(path.join(cwd, "child.pid"), "utf8"));
    expect(() => process.kill(childPid, 0)).toThrow();
  });
});
