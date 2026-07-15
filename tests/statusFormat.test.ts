import { describe, expect, it } from "vitest";
import { colorEnabled, formatStatusCell, renderStatusTable } from "../src/statusFormat.js";
import type { JobRow, JobStatus } from "../src/types.js";

const statuses: JobStatus[] = [
  "queued",
  "running",
  "needs-input",
  "done",
  "failed",
  "cancelled",
];

function job(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: 1,
    repo: "owner/repository",
    event_kind: "issue-comment",
    event_id: 1,
    number: 42,
    is_pull_request: 0,
    author: "owner",
    instruction: "inspect the task",
    status: "queued",
    phase: "security",
    mode: "read",
    session_id: null,
    worktree_path: null,
    branch: null,
    plan_path: null,
    pr_number: null,
    attempts: 0,
    last_error: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("colorEnabled", () => {
  it("disables color for non-TTY output", () => {
    expect(colorEnabled({ isTTY: false })).toBe(false);
  });

  it("enables color for a TTY when no override is present", () => {
    expect(colorEnabled({ isTTY: true })).toBe(true);
  });

  it("honors the NO_COLOR decision supplied by the caller", () => {
    expect(colorEnabled({ isTTY: true, noColor: true })).toBe(false);
    expect(colorEnabled({ isTTY: false, noColor: true })).toBe(false);
  });
});

describe("formatStatusCell", () => {
  it.each(statuses)("keeps %s unchanged and padded when color is disabled", (status) => {
    expect(formatStatusCell(status, false)).toBe(status.padEnd(13));
    expect(formatStatusCell(status, false)).not.toContain("\x1b[");
  });

  it.each(statuses)("keeps %s at 13 visible characters when color is enabled", (status) => {
    expect(stripAnsi(formatStatusCell(status, true))).toHaveLength(13);
  });

  it("wraps the status cell in an ANSI color and reset sequence", () => {
    const cell = formatStatusCell("running", true);
    expect(cell).toMatch(/^\x1b\[[0-9;]+m/);
    expect(cell).toMatch(/\x1b\[0m$/);
    expect(stripAnsi(cell)).toBe("running".padEnd(13));
  });

  it("assigns a different ANSI color code to every supported status", () => {
    const codes = statuses.map((status) => {
      const match = formatStatusCell(status, true).match(/^\x1b\[([0-9;]+)m/);
      return match?.[1];
    });
    expect(new Set(codes).size).toBe(statuses.length);
  });
});

describe("renderStatusTable", () => {
  it("renders the existing empty-state text without color", () => {
    expect(renderStatusTable([], "cc-mm", false)).toEqual(["No ADT tasks."]);
  });

  it("preserves the existing header and plain row layout", () => {
    const lines = renderStatusTable(
      [job({ id: 7, repo: "Xyz9Selu/example", number: 9, status: "running" })],
      "cc-mm",
      false,
    );

    expect(lines).toEqual([
      "ID".padEnd(8) + "STATUS".padEnd(13) + "PHASE".padEnd(14) + "EXECUTOR".padEnd(10) + "THREAD",
      "A-7".padEnd(8)
        + "running".padEnd(13)
        + "security".padEnd(14)
        + "cc-mm".padEnd(10)
        + "Xyz9Selu/example#9",
    ]);
  });

  it("preserves the caller-provided row order", () => {
    const lines = renderStatusTable(
      [
        job({ id: 3, status: "done" }),
        job({ id: 1, status: "queued" }),
        job({ id: 2, status: "failed" }),
      ],
      "cc-mm",
      false,
    );

    expect(lines.slice(1).map((line) => line.slice(0, 8).trim())).toEqual(["A-3", "A-1", "A-2"]);
  });

  it("colors only the status cell while leaving other visible fields intact", () => {
    const lines = renderStatusTable([job({ status: "needs-input" })], "cc-mm", true);
    const plainRow = stripAnsi(lines[1]);

    expect(plainRow).toBe(
      "A-1".padEnd(8)
        + "needs-input".padEnd(13)
        + "security".padEnd(14)
        + "cc-mm".padEnd(10)
        + "owner/repository#42",
    );
    expect(lines[1]).toContain("\x1b[");
    expect(lines[1]).toContain("\x1b[0m");
  });
});
