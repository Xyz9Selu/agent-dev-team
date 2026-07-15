import type { JobRow, JobStatus } from "./types.js";

const COLUMN_WIDTHS = {
  id: 8,
  status: 13,
  phase: 14,
  executor: 10,
} as const;

const STATUS_COLORS: Record<JobStatus, string> = {
  queued: "36",
  running: "34",
  "needs-input": "33",
  done: "32",
  failed: "31",
  cancelled: "90",
};

export function colorEnabled(options: { isTTY: boolean; noColor?: boolean }): boolean {
  return options.isTTY && options.noColor !== true;
}

export function formatStatusCell(status: JobStatus, colorOn: boolean): string {
  const paddedStatus = status.padEnd(COLUMN_WIDTHS.status);
  if (!colorOn) return paddedStatus;
  return `\x1b[${STATUS_COLORS[status]}m${paddedStatus}\x1b[0m`;
}

function headerLine(): string {
  return "ID".padEnd(COLUMN_WIDTHS.id)
    + "STATUS".padEnd(COLUMN_WIDTHS.status)
    + "PHASE".padEnd(COLUMN_WIDTHS.phase)
    + "EXECUTOR".padEnd(COLUMN_WIDTHS.executor)
    + "THREAD";
}

export function renderStatusTable(
  jobs: readonly JobRow[],
  executorKind: string,
  colorOn: boolean,
): string[] {
  if (jobs.length === 0) return ["No ADT tasks."];

  const lines = [headerLine()];
  for (const job of jobs) {
    lines.push(
      `A-${job.id}`.padEnd(COLUMN_WIDTHS.id)
        + formatStatusCell(job.status, colorOn)
        + job.phase.padEnd(COLUMN_WIDTHS.phase)
        + executorKind.padEnd(COLUMN_WIDTHS.executor)
        + `${job.repo}#${job.number}`,
    );
  }
  return lines;
}
