import { spawn } from "node:child_process";
import fs from "node:fs";

export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceTimer: NodeJS.Timeout | undefined;
    const finish = (code: number | null) => {
      if (timer) clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      options.signal?.removeEventListener("abort", abort);
      resolve({ code, stdout, stderr, timedOut });
    };
    const terminate = () => {
      terminateProcessTree(child.pid, "SIGTERM");
      forceTimer = setTimeout(() => terminateProcessTree(child.pid, "SIGKILL"), 10_000);
    };
    const abort = () => terminate();
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", finish);
    const timer = options.timeoutMs
      ? setTimeout(() => { timedOut = true; terminate(); }, options.timeoutMs)
      : undefined;
  });
}

function terminateProcessTree(rootPid: number | undefined, signal: NodeJS.Signals): void {
  if (!rootPid) return;
  const parentByPid = new Map<number, number>();
  try {
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
        parentByPid.set(pid, Number(fields[1]));
      } catch {
        // Process exited while /proc was being scanned.
      }
    }
  } catch {
    // Fall back to killing only the direct child on non-Linux systems.
  }
  const descendants: number[] = [];
  const collect = (parent: number) => {
    for (const [pid, ppid] of parentByPid) {
      if (ppid !== parent) continue;
      collect(pid);
      descendants.push(pid);
    }
  };
  collect(rootPid);
  for (const pid of [...descendants, rootPid]) {
    try { process.kill(pid, signal); }
    catch { /* Process already exited. */ }
  }
}
