import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { activeJob, enqueueEvent, getJob, openStore, queuedJobs, resetInterruptedJobs, transition } from "../src/store.js";
import type { TriggerEvent } from "../src/types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adt-store-"));
  dirs.push(dir);
  return openStore(path.join(dir, "state.db"));
}

function event(id: number, number = 1): TriggerEvent {
  return { repo: "o/r", kind: "issue-comment", id, number, author: "owner", body: "@agent analyze",
    url: "https://example.test", createdAt: new Date().toISOString(), isPullRequest: false };
}

describe("store", () => {
  it("deduplicates GitHub events", () => {
    const db = store();
    expect(enqueueEvent(db, event(1), "analyze", "read")).toBeTypeOf("number");
    expect(enqueueEvent(db, event(1), "analyze", "read")).toBeNull();
    db.close();
  });

  it("does not schedule two running jobs for one thread", () => {
    const db = store();
    const first = enqueueEvent(db, event(1), "one", "read")!;
    enqueueEvent(db, event(2), "two", "write");
    transition(db, first, "running");
    expect(queuedJobs(db, 10)).toHaveLength(0);
    db.close();
  });

  it("recovers jobs interrupted by a daemon restart", () => {
    const db = store();
    const id = enqueueEvent(db, event(1), "one", "read")!;
    transition(db, id, "running");
    expect(resetInterruptedJobs(db)).toBe(1);
    expect(getJob(db, id)?.status).toBe("queued");
    db.close();
  });

  it("can find the task targeted by a newly enqueued cancel command", () => {
    const db = store();
    const target = enqueueEvent(db, event(1), "implement", "write")!;
    transition(db, target, "running");
    const cancel = enqueueEvent(db, event(2), "取消", "read")!;
    expect(activeJob(db, "o/r", 1, cancel)?.id).toBe(target);
    db.close();
  });
});
