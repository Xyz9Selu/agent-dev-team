export type EventKind = "issue-comment" | "review" | "review-comment";
export type JobStatus =
  | "queued"
  | "running"
  | "needs-input"
  | "done"
  | "failed"
  | "cancelled";
export type JobPhase =
  | "security"
  | "analysis"
  | "planning"
  | "implementing"
  | "delivering";

export interface TriggerEvent {
  repo: string;
  kind: EventKind;
  id: number;
  number: number;
  author: string;
  body: string;
  url: string;
  createdAt: string;
  isPullRequest: boolean;
}

export interface RepositoryConfig {
  name: string;
  path: string;
}

export interface AdtConfig {
  github: {
    agentUser: string;
    allowedUsers: string[];
    pollIntervalSeconds: number;
  };
  executor: {
    kind: "cc-mm";
    command: string;
    maxMinutes: number;
  };
  isolation: {
    enabled: boolean;
    command: string;
    readOnlyHomePaths: string[];
    writableHomePaths: string[];
  };
  maxConcurrent: number;
  retentionDays: number;
  repositories: RepositoryConfig[];
}

export interface JobRow {
  id: number;
  repo: string;
  event_kind: EventKind;
  event_id: number;
  number: number;
  is_pull_request: number;
  author: string;
  instruction: string;
  status: JobStatus;
  phase: JobPhase;
  mode: "read" | "write";
  session_id: string | null;
  worktree_path: string | null;
  branch: string | null;
  plan_path: string | null;
  pr_number: number | null;
  attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export type ExecutorResult =
  | {
      status: "done";
      summary: string;
      tests?: string[];
    }
  | {
      status: "needs-input";
      summary: string;
      questions: string[];
      checkpoint: string;
    }
  | {
      status: "failed";
      summary: string;
      error: string;
    };
