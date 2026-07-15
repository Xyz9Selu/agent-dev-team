import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { ADT_HOME } from "./config.js";
import type { JobPhase, JobRow, JobStatus, TriggerEvent } from "./types.js";

export function openStore(dbPath = path.join(ADT_HOME, "state.db")): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      event_kind TEXT NOT NULL,
      event_id INTEGER NOT NULL,
      number INTEGER NOT NULL,
      is_pull_request INTEGER NOT NULL,
      author TEXT NOT NULL,
      instruction TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      phase TEXT NOT NULL DEFAULT 'security',
      mode TEXT NOT NULL DEFAULT 'read',
      session_id TEXT,
      worktree_path TEXT,
      branch TEXT,
      plan_path TEXT,
      pr_number INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(repo, event_kind, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_thread ON jobs(repo, number, created_at);
    CREATE TABLE IF NOT EXISTS cursors (
      repo TEXT PRIMARY KEY,
      since TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS controls (
      job_id INTEGER PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

export function requestCancel(db: Database.Database, jobId: number): void {
  db.prepare(`
    INSERT INTO controls(job_id, action) VALUES (?, 'cancel')
    ON CONFLICT(job_id) DO UPDATE SET action = 'cancel', created_at = unixepoch()
  `).run(jobId);
}

export function consumeCancelRequests(db: Database.Database): number[] {
  const rows = db.prepare("SELECT job_id FROM controls WHERE action = 'cancel'").all() as Array<{ job_id: number }>;
  if (rows.length > 0) db.prepare("DELETE FROM controls WHERE action = 'cancel'").run();
  return rows.map((row) => row.job_id);
}

export function findWorkspace(db: Database.Database, repo: string, number: number): JobRow | null {
  return (db.prepare(`
    SELECT * FROM jobs WHERE repo = ?
      AND (number = ? OR pr_number = ?)
      AND worktree_path IS NOT NULL
    ORDER BY updated_at DESC LIMIT 1
  `).get(repo, number, number) as JobRow | undefined) ?? null;
}

export function enqueueEvent(
  db: Database.Database,
  event: TriggerEvent,
  instruction: string,
  mode: "read" | "write",
): number | null {
  const result = db.prepare(`
    INSERT OR IGNORE INTO jobs
      (repo, event_kind, event_id, number, is_pull_request, author, instruction, mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event.repo,
    event.kind,
    event.id,
    event.number,
    event.isPullRequest ? 1 : 0,
    event.author,
    instruction,
    mode,
  );
  return result.changes === 1 ? Number(result.lastInsertRowid) : null;
}

export function getJob(db: Database.Database, id: number): JobRow | null {
  return (db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined) ?? null;
}

export function queuedJobs(db: Database.Database, limit: number): JobRow[] {
  return db.prepare(`
    SELECT j.* FROM jobs j
    WHERE j.status = 'queued'
      AND NOT EXISTS (
        SELECT 1 FROM jobs active
        WHERE active.repo = j.repo AND active.number = j.number
          AND active.status = 'running'
      )
    ORDER BY j.created_at, j.id LIMIT ?
  `).all(limit) as JobRow[];
}

export function allJobs(db: Database.Database, limit = 100): JobRow[] {
  return db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?").all(limit) as JobRow[];
}

export function updateJob(
  db: Database.Database,
  id: number,
  values: Partial<Pick<JobRow,
    "status" | "phase" | "mode" | "session_id" | "worktree_path" | "branch" |
    "plan_path" | "pr_number" | "attempts" | "last_error"
  >>,
): void {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  const set = entries.map(([key]) => `${key} = ?`).join(", ");
  db.prepare(`UPDATE jobs SET ${set}, updated_at = unixepoch() WHERE id = ?`)
    .run(...entries.map(([, value]) => value), id);
}

export function transition(
  db: Database.Database,
  id: number,
  status: JobStatus,
  phase?: JobPhase,
  error?: string | null,
): void {
  updateJob(db, id, { status, ...(phase ? { phase } : {}), last_error: error ?? null });
}

export function resetInterruptedJobs(db: Database.Database): number {
  return db.prepare(`
    UPDATE jobs SET status = 'queued', last_error = 'ADT restarted during execution',
      updated_at = unixepoch()
    WHERE status = 'running'
  `).run().changes;
}

export function findResumableJob(db: Database.Database, repo: string, number: number): JobRow | null {
  return (db.prepare(`
    SELECT * FROM jobs WHERE repo = ? AND number = ?
      AND status IN ('needs-input', 'cancelled', 'failed')
    ORDER BY updated_at DESC LIMIT 1
  `).get(repo, number) as JobRow | undefined) ?? null;
}

export function latestJob(db: Database.Database, repo: string, number: number): JobRow | null {
  return (db.prepare(`
    SELECT * FROM jobs WHERE repo = ? AND number = ? ORDER BY updated_at DESC LIMIT 1
  `).get(repo, number) as JobRow | undefined) ?? null;
}

export function activeJob(db: Database.Database, repo: string, number: number, excludeId?: number): JobRow | null {
  return (db.prepare(`
    SELECT * FROM jobs WHERE repo = ? AND number = ? AND status IN ('queued', 'running')
      AND (? IS NULL OR id != ?)
    ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
  `).get(repo, number, excludeId ?? null, excludeId ?? null) as JobRow | undefined) ?? null;
}

export function deleteExpiredJobs(db: Database.Database, retentionDays: number): number {
  return db.prepare(`
    DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled')
      AND updated_at < unixepoch() - (? * 86400)
  `).run(retentionDays).changes;
}

export function setCursor(db: Database.Database, repo: string, since: string): void {
  db.prepare(`
    INSERT INTO cursors(repo, since) VALUES (?, ?)
    ON CONFLICT(repo) DO UPDATE SET since = excluded.since
  `).run(repo, since);
}

export function getCursor(db: Database.Database, repo: string): string | null {
  const row = db.prepare("SELECT since FROM cursors WHERE repo = ?").get(repo) as { since: string } | undefined;
  return row?.since ?? null;
}
